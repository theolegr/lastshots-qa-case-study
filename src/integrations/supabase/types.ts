export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      participants: {
        Row: {
          avatar_emoji: string
          id: string
          is_host: boolean
          joined_at: string
          name: string
          party_id: string
          user_id: string
        }
        Insert: {
          avatar_emoji?: string
          id?: string
          is_host?: boolean
          joined_at?: string
          name: string
          party_id: string
          user_id: string
        }
        Update: {
          avatar_emoji?: string
          id?: string
          is_host?: boolean
          joined_at?: string
          name?: string
          party_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          capture_hours: number
          code: string
          created_at: string
          ends_at: string | null
          host_name: string
          id: string
          max_situations: number
          max_votes: number
          name: string
          status: string
          voting_ends_at: string | null
          voting_hours: number
        }
        Insert: {
          capture_hours?: number
          code: string
          created_at?: string
          ends_at?: string | null
          host_name: string
          id?: string
          max_situations?: number
          max_votes?: number
          name: string
          status?: string
          voting_ends_at?: string | null
          voting_hours?: number
        }
        Update: {
          capture_hours?: number
          code?: string
          created_at?: string
          ends_at?: string | null
          host_name?: string
          id?: string
          max_situations?: number
          max_votes?: number
          name?: string
          status?: string
          voting_ends_at?: string | null
          voting_hours?: number
        }
        Relationships: []
      }
      photos: {
        Row: {
          captured_at: string
          id: string
          image_url: string
          participant_id: string
          party_id: string
          situation_id: string
        }
        Insert: {
          captured_at?: string
          id?: string
          image_url: string
          participant_id: string
          party_id: string
          situation_id: string
        }
        Update: {
          captured_at?: string
          id?: string
          image_url?: string
          participant_id?: string
          party_id?: string
          situation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_situation_id_fkey"
            columns: ["situation_id"]
            isOneToOne: false
            referencedRelation: "situations"
            referencedColumns: ["id"]
          },
        ]
      }
      situation_pool: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          text?: string
        }
        Relationships: []
      }
      situations: {
        Row: {
          display_order: number
          id: string
          party_id: string
          title: string
        }
        Insert: {
          display_order?: number
          id?: string
          party_id: string
          title: string
        }
        Update: {
          display_order?: number
          id?: string
          party_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "situations_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          created_at: string
          id: string
          photo_id: string
          voter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_id: string
          voter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_party_with_host: {
        Args: { _host_name: string; _party_name: string }
        Returns: Json
      }
      get_party_by_code: {
        Args: { _code: string }
        Returns: {
          capture_hours: number
          code: string
          created_at: string
          ends_at: string
          host_name: string
          id: string
          max_situations: number
          max_votes: number
          name: string
          status: string
          voting_ends_at: string
          voting_hours: number
        }[]
      }
      is_party_host: {
        Args: { _party_id: string; _user_id: string }
        Returns: boolean
      }
      is_party_participant: {
        Args: { _party_id: string; _user_id: string }
        Returns: boolean
      }
      sync_party_situations: {
        Args: { _party_id: string; _target: number }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
