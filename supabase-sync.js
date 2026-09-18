const SUPABASE_URL = 'https://zdjcsdgkszmajvpvdrsk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkamNzZGdrc3ptYWp2cHZkcnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjkzODYsImV4cCI6MjEwNTMwNTM4Nn0.2R4r91pBRj6qOK2tRrSb1eaqxuCdmQ_bWv_nE6P9rgw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class CloudSync {
  // --- ANIMAL REGISTRY ---
  static async registerAnimal(animalId, breed, birthDate, status) {
    if (!navigator.onLine) {
      alert('Offline: Saved locally to device storage.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('animals')
      .insert([{ animal_id: animalId, breed: breed, birth_date: birthDate, status: status }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
      if (error.code === '23505') {
        alert('Practical Farm Check: 🐄 Animal ID "' + animalId + '" is already registered!');
      } else {
        alert('Cloud Sync Error: ' + error.message);
      }
      return false;
    }

    console.log('Successfully registered animal to Supabase Cloud!');
    alert('Success! Animal profile registered in cloud database.');
    return true;
  }

  // --- MILK PRODUCTION LOGS ---
  static async pushMilkLog(animalId, yieldLiters) {
    if (!navigator.onLine) {
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

    console.log('Successfully synced milk log to Supabase Cloud!');
    alert('Success! Milk record saved to cloud database.');
    return true;
  }

  // --- BREEDING SERVICE LOGS ---
  static async pushBreedingLog(animalId, breedingDate, expectedCalving) {
    if (!navigator.onLine) {
      alert('Offline: Saved locally to device storage.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('breeding_logs')
      .insert([{ animal_id: animalId, breeding_date: breedingDate, expected_calving: expectedCalving }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
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

  // --- HEALTH & TREATMENT LOGS ---
  static async pushHealthLog(animalId, treatmentType, description, treatmentDate, cost) {
    if (!navigator.onLine) {
      alert('Offline: Saved locally to device storage.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('health_logs')
      .insert([{ 
        animal_id: animalId, 
        treatment_type: treatmentType, 
        description: description, 
        treatment_date: treatmentDate, 
        cost: cost 
      }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
      alert('Cloud Sync Error: ' + error.message);
      return false;
    }

    console.log('Successfully synced health log to Supabase Cloud!');
    alert('Success! Health treatment recorded to cloud database.');
    return true;
  }

  // --- FARM EXPENSE LOGS ---
  static async pushExpenseLog(category, amount, expenseDate, notes) {
    if (!navigator.onLine) {
      alert('Offline: Saved locally to device storage.');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('expense_logs')
      .insert([{ 
        category: category, 
        amount: amount, 
        expense_date: expenseDate, 
        notes: notes 
      }]);

    if (error) {
      console.error('Cloud Sync Error:', error.message);
      alert('Cloud Sync Error: ' + error.message);
      return false;
    }

    console.log('Successfully synced expense log to Supabase Cloud!');
    alert('Success! Farm expense recorded to cloud database.');
    return true;
  }

  // --- INDIVIDUAL ANIMAL 360° PROFILE QUERY ---
  static async getAnimalProfile(animalId) {
    if (!navigator.onLine) {
      console.log('Offline: Cannot fetch remote animal profile.');
      return null;
    }

    try {
      const { data: animal, error: animalError } = await supabaseClient
        .from('animals')
        .select('*')
        .eq('animal_id', animalId)
        .single();

      if (animalError) throw animalError;
      if (!animal) return null;

      const { data: milkLogs, error: milkError } = await supabaseClient
        .from('milk_logs')
        .select('*')
        .eq('animal_id', animalId)
        .order('created_at', { ascending: false });

      if (milkError) throw milkError;

      const { data: breedingLogs, error: breedingError } = await supabaseClient
        .from('breeding_logs')
        .select('*')
        .eq('animal_id', animalId)
        .order('breeding_date', { ascending: false });

      if (breedingError) throw breedingError;

      const { data: healthLogs, error: healthError } = await supabaseClient
        .from('health_logs')
        .select('*')
        .eq('animal_id', animalId)
        .order('treatment_date', { ascending: false });

      if (healthError) throw healthError;

      return {
        animal: animal,
        milkLogs: milkLogs || [],
        breedingLogs: breedingLogs || [],
        healthLogs: healthLogs || []
      };

    } catch (error) {
      console.error('Error fetching animal 360 profile:', error.message);
      return null;
    }
  }
}
