export const sampleInvoiceId = "00000000-0000-0000-0000-00000000b001";

export const sampleInvoiceEnabled =
  __DEV__ &&
  /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2):54321\/?$/.test(
    process.env.EXPO_PUBLIC_SUPABASE_URL ?? ""
  );
