/**
 * Small helper to emit step-based progress.
 */

export function createStepProgress({ tier, totalSteps = 1, onProgress }) {
  let current = 0;

  const emit = (label) => {
    if (typeof onProgress === 'function') {
      onProgress({ tier, current, total: totalSteps, label });
    }
  };

  const step = (label) => {
    current += 1;
    emit(label);
  };

  return { step, emit };
}
