import { z } from "zod";

const previewUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => url.startsWith("https://"), "URL must start with https://")
  .refine((url) => !url.includes("localhost"), "localhost URLs are not allowed")
  .refine((url) => !url.includes("127.0.0.1"), "local IP URLs are not allowed");

export function validatePreviewUrl(input: string): string {
  return previewUrlSchema.parse(input);
}
