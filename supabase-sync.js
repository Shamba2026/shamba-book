const SUPABASE_URL = 'https://zdjcsdgkszmajvpvdrsk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkamNzZGdrc3ptYWp2cHZkcnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjkzODYsImV4cCI6MjEwNTMwNTM4Nn0.2R4r91pBRj6qOK2tRrSb1eaqxuCdmQ_bWv_nE6P9rgw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class CloudSync {
  static async pushMilkLog(animalId, yieldLiters) {
    if (!navigator.onLine) {
      console.log('Offline: Saving locally.');
      alert('Offline: Saved locally to device storage.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('milk_logs')
      .insert([{ animal_id: animalId, yield_liters: yieldLiters }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
      alert('Cloud Sync Error: ' + error.message);
      return false;
    }

    console.log('Successfully synced to Supabase Cloud!');
    alert('Success! Milk record saved to cloud database.');
    return true;
  }

  static async pushBreedingLog(animalId, breedingDate, expectedCalving) {
    if (!navigator.onLine) {
      console.log('Offline: Saving locally.');
      alert('Offline: Saved locally to device storage.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('breeding_logs')
      .insert([{ 
        animal_id: animalId, 
        breeding_date: breedingDate,
        expected_calving: expectedCalving
      }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
      // PostgreSQL unique violation error code
      if (error.code === '23505') {
        alert('Practical Farm Check: 🐄 This cow already has a breeding record logged for this exact date!');
      } else {
        alert('Cloud Sync Error: ' + error.message);
      }
      return false;
    }

    console.log('Successfully synced breeding log to Supabase Cloud!');
    alert('Success! Breeding record saved to cloud database.');
    return true;
  }
}
