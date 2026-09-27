// Pure submission validation logic — no database, no side effects.

export const MAX_PHOTO_SIZE = 15 * 1024 * 1024; // 15MB
export const MAX_SHOTS = 5;

/** Returns "too_large" if the blob exceeds the size limit, null otherwise. */
export function validatePhotoBlob(blob: Blob): "too_large" | null {
  if (blob.size > MAX_PHOTO_SIZE) return "too_large";
  return null;
}

/** Returns true if the participant still has shots remaining. */
export function hasRemainingShots(usedShots: number, maxShots: number = MAX_SHOTS): boolean {
  return usedShots < maxShots;
}

/** Returns true if the situation has not already been completed by this participant. */
export function canSubmitToSituation(
  situationId: string,
  completedSituationIds: string[]
): boolean {
  return !completedSituationIds.includes(situationId);
}

/** Returns true if a photo can be submitted: shots remaining AND situation not completed. */
export function canSubmitPhoto(
  situationId: string,
  completedSituationIds: string[],
  usedShots: number,
  maxShots: number = MAX_SHOTS
): boolean {
  return hasRemainingShots(usedShots, maxShots) && canSubmitToSituation(situationId, completedSituationIds);
}
