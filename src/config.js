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
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXAiLCJyZWYiOiJ6ZGoianNkZ2tzem1hanZwdmRyc2siLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4OTcyMzkzOCwiZXhwIjoxNjQ1MzA1Mzg2fQ.2R4r91pBRj6qOK2tRrSb1eaqxuCdmQ_bWv_nE6P9rgw",
    supabaseJsCdn: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
  })
});
