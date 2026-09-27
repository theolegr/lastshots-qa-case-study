import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RETENTION_HOURS, retentionCutoff } from "../_shared/retention.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting cleanup of old parties...");

    // Create Supabase client with service role for admin access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // The cutoff rule lives in `_shared/retention.ts` so it can be asserted by
    // the unit tier — MO-001 was "verified by inspection" for exactly this
    // arithmetic. See that module for why it is epoch maths and not setHours.
    const cutoffTime = retentionCutoff();

    console.log(`Cutoff time: ${cutoffTime.toISOString()} (retention ${RETENTION_HOURS}h)`);

    // Find parties created more than RETENTION_HOURS ago
    const { data: oldParties, error: fetchError } = await supabase
      .from("parties")
      .select("id, code, name, created_at")
      .lt("created_at", cutoffTime.toISOString());

    if (fetchError) {
      console.error("Error fetching old parties:", fetchError);
      throw fetchError;
    }

    if (!oldParties || oldParties.length === 0) {
      console.log("No parties to clean up");
      return new Response(
        JSON.stringify({ message: "No parties to clean up", deleted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${oldParties.length} parties to delete:`, oldParties.map(p => p.code));

    const partyIds = oldParties.map(p => p.id);
    let deletedPhotosFromStorage = 0;

    // Delete photos from storage for each party
    for (const partyId of partyIds) {
      const { data: files, error: listError } = await supabase.storage
        .from("party-photos")
        .list(partyId);

      if (listError) {
        console.error(`Error listing files for party ${partyId}:`, listError);
        continue;
      }

      if (files && files.length > 0) {
        // List all files in party folder (including subfolders)
        const filePaths: string[] = [];
        
        for (const file of files) {
          // Check if it's a folder (participant folder)
          const { data: subFiles } = await supabase.storage
            .from("party-photos")
            .list(`${partyId}/${file.name}`);
          
          if (subFiles && subFiles.length > 0) {
            for (const subFile of subFiles) {
              filePaths.push(`${partyId}/${file.name}/${subFile.name}`);
            }
          } else if (file.name) {
            filePaths.push(`${partyId}/${file.name}`);
          }
        }

        if (filePaths.length > 0) {
          console.log(`Deleting ${filePaths.length} files from storage for party ${partyId}`);
          const { error: deleteStorageError } = await supabase.storage
            .from("party-photos")
            .remove(filePaths);

          if (deleteStorageError) {
            console.error(`Error deleting storage files for party ${partyId}:`, deleteStorageError);
          } else {
            deletedPhotosFromStorage += filePaths.length;
          }
        }
      }
    }

    // Delete votes (must delete before photos due to foreign key)
    const { data: photos } = await supabase
      .from("photos")
      .select("id")
      .in("party_id", partyIds);

    if (photos && photos.length > 0) {
      const photoIds = photos.map(p => p.id);
      const { error: votesError } = await supabase
        .from("votes")
        .delete()
        .in("photo_id", photoIds);

      if (votesError) {
        console.error("Error deleting votes:", votesError);
      } else {
        console.log(`Deleted votes for ${photoIds.length} photos`);
      }
    }

    // Delete photos
    const { error: photosError } = await supabase
      .from("photos")
      .delete()
      .in("party_id", partyIds);

    if (photosError) {
      console.error("Error deleting photos:", photosError);
    } else {
      console.log(`Deleted photos for ${partyIds.length} parties`);
    }

    // Delete situations
    const { error: situationsError } = await supabase
      .from("situations")
      .delete()
      .in("party_id", partyIds);

    if (situationsError) {
      console.error("Error deleting situations:", situationsError);
    } else {
      console.log(`Deleted situations for ${partyIds.length} parties`);
    }

    // Delete participants
    const { error: participantsError } = await supabase
      .from("participants")
      .delete()
      .in("party_id", partyIds);

    if (participantsError) {
      console.error("Error deleting participants:", participantsError);
    } else {
      console.log(`Deleted participants for ${partyIds.length} parties`);
    }

    // Delete parties
    const { error: partiesError } = await supabase
      .from("parties")
      .delete()
      .in("id", partyIds);

    if (partiesError) {
      console.error("Error deleting parties:", partiesError);
      throw partiesError;
    }

    console.log(`Successfully deleted ${oldParties.length} parties and their data`);

    return new Response(
      JSON.stringify({
        message: "Cleanup completed",
        deleted: oldParties.length,
        deletedParties: oldParties.map(p => ({ code: p.code, name: p.name })),
        deletedPhotosFromStorage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Cleanup error:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
