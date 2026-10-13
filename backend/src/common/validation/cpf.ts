export function onlyDigits(s: string) { return (s || '').replace(/\D/g, ''); }
export function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(cpf[i], 10) * (len + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== parseInt(cpf[len], 10)) return false;
  }
  return true;
}
export function maskCpf(cpf: string | null): string | null {
  const d = onlyDigits(cpf || '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null;
}
