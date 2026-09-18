class FarmBiologicalLogic {
  static CATTLE_GESTATION_DAYS = 283;

  static calculateExpectedCalving(breedingDateStr) {
    const date = new Date(breedingDateStr);
    date.setDate(date.getDate() + this.CATTLE_GESTATION_DAYS);
    return date.toISOString().split('T')[0];
  }

  static validateMilkEntry(animal, yieldLiters) {
    if (yieldLiters <= 0 || yieldLiters > 60) {
      return { isValid: false, error: 'Unusual milk volume. Please verify entry (0-60L).' };
    }
    if (animal.isDry) {
      return { isValid: false, error: 'Animal is currently in dry-off period.' };
    }
    return { isValid: true };
  }
}
