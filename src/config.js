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
    farmId: "0d792a67-785f-4e01-b425-e97b958f078c",
    supabaseUrl: "https://zdjcsdgkszmajvpvdrsk.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkamNzZGdrc3ptYWp2cHZkcnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjkzODYsImV4cCI6MjEwNTMwNTM4Nn0.2R4r91pBRj6qOK2tRrSb1eaqxuCdmQ_bWv_nE6P9rgw",
    supabaseJsCdn: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
  })
});
