export const APP_CONFIG = Object.freeze({
  name: "Ngombe Herdbook",
  tagline: "Mifugo yangu, kiganjani mwangu.",
  timezone: "Africa/Nairobi",
  currency: "KES",
  milk: Object.freeze({
    pricePerLiter: 49,
    sessions: Object.freeze(["morning", "afternoon", "evening"]),
    paymentDay: "Saturday"
  }),
  feed: Object.freeze({ unit: "kg" }),
  farm: Object.freeze({ locality: "South Kinangop, Kenya" }),
  animals: Object.freeze({
    requirePhoto: true,
    supportsNicknames: true,
    supportsRfid: true,
    supportsQr: true
  }),
  cloud: Object.freeze({
    enabled: false,
    supabaseUrl: "https://zdjcsdgkszmajvpvdrsk.supabase.co",
    supabaseAnonKey: null,
    supabaseJsCdn: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
  })
});
