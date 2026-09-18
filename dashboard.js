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
}

// Auto-render stats on page load if dashboard container is present
document.addEventListener('DOMContentLoaded', () => {
  FarmDashboard.renderDashboardUI();
});
