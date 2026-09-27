import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-export from canonical location for backwards compat
export { MAX_PHOTO_SIZE, validatePhotoBlob } from "./submissionRules";
