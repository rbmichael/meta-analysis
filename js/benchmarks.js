export const BENCHMARKS = [

{
 name: "Validated SMD (3-study example)",
 type: "SMD",
 data: [
  {label:"S1", m1:2.3, sd1:1.2, n1:50, m2:1.8, sd2:1.1, n2:50},
  {label:"S2", m1:2.8, sd1:1.5, n1:40, m2:2.0, sd2:1.3, n2:40},
  {label:"S3", m1:2.1, sd1:1.1, n1:30, m2:1.7, sd2:1.0, n2:30}
 ],
 expected: {
  FE: 0.461,
  RE: 0.461,
  tau2: 0.00,
  I2: 0.0
 }
},

{
 name: "Validated MD (balanced studies)",
 type: "MD",
 data: [
  {label:"S1", m1:5, sd1:1, n1:50, m2:4, sd2:1, n2:50},
  {label:"S2", m1:6, sd1:1, n1:50, m2:5, sd2:1, n2:50},
  {label:"S3", m1:7, sd1:1, n1:50, m2:6, sd2:1, n2:50}
 ],
 expected: {
  FE: 1.0,
  RE: 1.0,
  tau2: 0.0,
  I2: 0.0
 }
},

{
 name: "Simple MD (3 studies)",
 type: "MD",
 data: [
  {label:"A", m1:10, sd1:2, n1:50, m2:8, sd2:2, n2:50},
  {label:"B", m1:12, sd1:3, n1:40, m2:9, sd2:3, n2:40},
  {label:"C", m1:9, sd1:2, n1:30, m2:7, sd2:2, n2:30}
 ],
 expected: {
  FE: 2.182,
  RE: 2.182,
  tau2: 0.000,
  I2: 0.0
 }
},

{
 name: "Borenstein example (moderate heterogeneity)",
 type: "MD",
 data: [
  {label:"S1", m1:5.1, sd1:1.2, n1:30, m2:4.8, sd2:1.1, n2:30},
  {label:"S2", m1:6.0, sd1:1.5, n1:40, m2:5.2, sd2:1.3, n2:40},
  {label:"S3", m1:4.9, sd1:1.1, n1:25, m2:4.2, sd2:1.0, n2:25},
  {label:"S4", m1:5.5, sd1:1.3, n1:35, m2:4.7, sd2:1.2, n2:35}
 ],
 expected: {
  FE: 0.646,
  RE: 0.646,
  tau2: 0.00,
  I2: 0.0
 }
}

];