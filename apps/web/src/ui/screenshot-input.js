// Wires an <input type="file" accept="image/*"> to read the chosen image as
// a base64 data URL (matches what the Worker expects — see
// apps/worker/src/routes/manual-payments.ts::validateScreenshot). Calls
// onChange(dataUrl | null) whenever the selection changes.
export function wireScreenshotInput(inputEl, onChange) {
  inputEl.addEventListener('change', () => {
    const file = inputEl.files?.[0];
    if (!file) {
      onChange(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => onChange(null);
    reader.readAsDataURL(file);
  });
}
