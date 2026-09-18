class FarmDashboard {
  /**
   * Fetches core real-time analytics for the Shamba Book dashboard.
   * Returns a summary object with total animals, milk yield, active breeding logs, and expenses.
   */
  static async getFarmAnalytics() {
    if (!navigator.onLine) {
      console.log('Offline: Analytics running on local cached state.');
      return null;
    }

    try {
      // 1. Total Registered Animals
      const { count: animalCount, error: animalError } = await supabaseClient
        .from('animals')
        .select('*', { count: 'exact', head: true });

      if (animalError) throw animalError;

      // 2. Total Milk Production (Sum of liters)
      const { data: milkData, error: milkError } = await supabaseClient
        .from('milk_logs')
        .select('yield_liters');

      if (milkError) throw milkError;
      const totalMilkYield = milkData ? milkData.reduce((sum, row) => sum + Number(row.yield_liters || 0), 0) : 0;

      // 3. Active Breeding & Expected Calvings Count
      const { count: breedingCount, error: breedingError } = await supabaseClient
        .from('breeding_logs')
        .select('*', { count: 'exact', head: true });

      if (breedingError) throw breedingError;

      // 4. Total Farm Expenses (Sum of amounts)
      const { data: expenseData, error: expenseError } = await supabaseClient
        .from('expense_logs')
        .select('amount');

      if (expenseError) throw expenseError;
      const totalExpenses = expenseData ? expenseData.reduce((sum, row) => sum + Number(row.amount || 0), 0) : 0;

      const analyticsSummary = {
        totalAnimals: animalCount || 0,
        totalMilkLiters: totalMilkYield.toFixed(1),
        activeBreedings: breedingCount || 0,
        totalExpensesKes: totalExpenses.toFixed(2)
      };

      console.log('Farm Analytics Loaded Successfully:', analyticsSummary);
      return analyticsSummary;

    } catch (err) {
      console.error('Error fetching farm analytics:', err.message);
      return null;
    }
  }

  /**
   * Renders dashboard metrics directly into UI elements if IDs exist on the page.
   */
  static async renderDashboardUI() {
    const stats = await this.getFarmAnalytics();
    if (!stats) return;

    // Helper to safely update DOM elements if they exist
    const updateText = (elementId, text) => {
      const el = document.getElementById(elementId);
      if (el) el.textContent = text;
    };

    updateText('stat-total-animals', stats.totalAnimals);
    updateText('stat-total-milk', `${stats.totalMilkLiters} L`);
    updateText('stat-active-breedings', stats.activeBreedings);
    updateText('stat-total-expenses', `Ksh ${stats.totalExpensesKes}`);
  }

  /**
   * Fetches and renders an individual animal's 360° profile into the DOM container.
   */
  static async renderAnimalProfile(animalId) {
    const container = document.getElementById('animalProfileContainer');
    if (!container) return;

    container.innerHTML = '<p>Loading profile...</p>';

    const profile = await CloudSync.getAnimalProfile(animalId);

    if (!profile || !profile.animal) {
      container.innerHTML = `<p style="color: red;">Animal ID "${animalId}" not found in cloud database.</p>`;
      return;
    }

    const { animal, milkLogs, breedingLogs, healthLogs } = profile;

    let milkHtml = milkLogs.length > 0 
      ? milkLogs.map(m => `<li>${m.created_at ? new Date(m.created_at).toLocaleDateString() : 'N/A'}: <strong>${m.yield_liters} L</strong></li>`).join('')
      : '<li>No milk records found.</li>';

    let breedingHtml = breedingLogs.length > 0
      ? breedingLogs.map(b => `<li>Bred: ${b.breeding_date} | Expected Calving: ${b.expected_calving}</li>`).join('')
      : '<li>No breeding records found.</li>';

    let healthHtml = healthLogs.length > 0
      ? healthLogs.map(h => `<li>${h.treatment_date} - <strong>${h.treatment_type}</strong> (${h.description || 'No desc'}): Ksh ${h.cost}</li>`).join('')
      : '<li>No health records found.</li>';

    container.innerHTML = `
      <div style="background: #f1f8e9; padding: 15px; border-radius: 6px; border: 1px solid #c8e6c9;">
        <h3 style="margin-top: 0; color: #2e7d32;">🐄 Animal Profile: ${animal.animal_id}</h3>
        <p><strong>Breed:</strong> ${animal.breed} | <strong>Status:</strong> ${animal.status} | <strong>Birth Date:</strong> ${animal.birth_date || 'N/A'}</p>
        
        <h4>Milk Production History</h4>
        <ul>${milkHtml}</ul>

        <h4>Breeding History</h4>
        <ul>${breedingHtml}</ul>

        <h4>Health & Treatment History</h4>
        <ul>${healthHtml}</ul>
      </div>
    `;
  }
}

// Auto-render stats on page load if dashboard container is present
document.addEventListener('DOMContentLoaded', () => {
  FarmDashboard.renderDashboardUI();
});
