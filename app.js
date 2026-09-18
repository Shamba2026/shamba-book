// Handle Milk Form Submission
document.getElementById('milking-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const animalId = document.getElementById('milk-animal-id').value;
  const yieldLiters = parseFloat(document.getElementById('milk-amount').value);

  const animalMock = { id: animalId, isDry: false };
  const validation = FarmBiologicalLogic.validateMilkEntry(animalMock, yieldLiters);

  if (!validation.isValid) {
    alert(validation.error);
    return;
  }

  const synced = await CloudSync.pushMilkLog(animalId, yieldLiters);
  const statusMsg = synced ? "and synced to Supabase Cloud!" : "and saved offline.";
  alert(`Logged ${yieldLiters}L for ${animalId} ${statusMsg}`);

  this.reset();
});

// Handle Breeding Form Submission
document.getElementById('breeding-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const animalId = document.getElementById('breed-animal-id').value;
  const breedingDate = document.getElementById('breeding-date').value;

  const expectedCalving = FarmBiologicalLogic.calculateExpectedCalving(breedingDate);

  const synced = await CloudSync.pushBreedingLog(animalId, breedingDate, expectedCalving);
  const statusMsg = synced ? "and synced to Supabase Cloud!" : "and saved offline.";
  alert(`Breeding logged! Expected calving date: ${expectedCalving} (${statusMsg})`);

  this.reset();
});
