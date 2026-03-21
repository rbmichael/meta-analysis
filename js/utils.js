// ================= ROUNDING =================

// Safe rounding to n decimal places
export function round(value, digits = 3) {
 if (!isFinite(value)) return value;

 const factor = Math.pow(10, digits);
 return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Format for display (fixed decimals, keeps trailing zeros)
export function fmt(value, digits = 3) {
 if (!isFinite(value)) return "NA";
 return round(value, digits).toFixed(digits);
}

// ================= T CRITICAL =================
// Approximate t critical (two-tailed, 95%)
export function tCritical(df){

 // Simple lookup for small df (accurate)
 const table = {
  1:12.706, 2:4.303, 3:3.182, 4:2.776, 5:2.571,
  6:2.447, 7:2.365, 8:2.306, 9:2.262, 10:2.228,
  12:2.179, 15:2.131, 20:2.086, 25:2.060, 30:2.042
 };

 if(df <= 30){
  const keys = Object.keys(table).map(Number);
  const closest = keys.reduce((a,b)=>Math.abs(b-df)<Math.abs(a-df)?b:a);
  return table[closest];
 }

 // large df → normal approx
 return 1.96;
}