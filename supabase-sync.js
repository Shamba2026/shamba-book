const SUPABASE_URL = 'https://zdjcsdgkszmajvpvdrsk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkamNzZGdrc3ptYWp2cHZkcnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjkzODYsImV4cCI6MjEwNTMwNTM4Nn0.2R4r91pBRj6qOK2tRrSb1eaqxuCdmQ_bWv_nE6P9rgw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class CloudSync {
  static async pushMilkLog(animalId, yieldLiters) {
    if (!navigator.onLine) {
      console.log('Offline: Saving locally.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('milk_logs')
      .insert([{ animal_id: animalId, yield_liters: yieldLiters }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
      return false;
    }

    console.log('Successfully synced to Supabase Cloud!');
    return true;
  }

  static async pushBreedingLog(animalId, breedingDate, expectedCalving) {
    if (!navigator.onLine) return false;

    const { data, error } = await supabaseClient
      .from('breeding_logs')
      .insert([{ 
        animal_id: animalId, 
        breeding_date: breedingDate,
        expected_calving: expectedCalving
      }]);

    if (error) console.error('Cloud Sync Error:', error.message);
    return !error;
  }
}
