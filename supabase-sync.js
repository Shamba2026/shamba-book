const SUPABASE_URL = 'https://zdjcsdgkszmajvpvdrsk.supabase.co';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_COPIED_ANON_KEY_HERE';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class CloudSync {
  static async pushMilkLog(animalId, yieldLiters) {
    if (!navigator.onLine) {
      console.log('Offline: Saving locally.');
      return false;
    }

    const { data, error } = await supabase
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

    const { data, error } = await supabase
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
