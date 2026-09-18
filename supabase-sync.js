const SUPABASE_URL = 'https://zdjcsdgkszmajvpvdrsk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhGciOiJIUzI1NiIsInI1cC5iIC5IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkamNzZGdrc3ptYWp2cHZkcnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMzg0MjgsImV4cCI6MjA1NjgxNDQyOH0.Xb5_example_key_placeholder'; // (Keep your actual key here!)

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
