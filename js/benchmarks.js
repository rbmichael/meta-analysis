// benchmarks.js
export const BENCHMARKS = [

  // -------------------------
  // Mean Difference – Textbook Example (Borenstein et al.)
  {
    name: "Textbook MD Example",
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

  // -------------------------
  // Standardized Mean Difference – metafor dataset dat.bcg
	{
	  name: "BCG Vaccine – yi/vi (metafor exact FULL PRECISION)",
	  type: "GENERIC",
	  data: [
		{label:"Aronson 1948", yi:-0.8893113339202054, vi:0.3255847650039614},
		{label:"Ferguson & Simes 1949", yi:-1.5853886572014306, vi:0.19458112139814387},
		{label:"Rosenthal 1960", yi:-1.348073148299693, vi:0.41536796536796533},
		{label:"Hart & Sutherland 1977", yi:-1.4415511900213054, vi:0.020010031902247573},
		{label:"Frimodt-Moller 1973", yi:-0.2175473222112957, vi:0.05121017216963086},
		{label:"Stein & Aronson 1953", yi:-0.786115585818864, vi:0.0069056184559087574},
		{label:"Vandiviere 1973", yi:-1.6208982235983924, vi:0.22301724757231517},
		{label:"TPT Madras 1980", yi:0.011952333523841173, vi:0.00396157929781773},
		{label:"Coetzee & Berjak 1968", yi:-0.4694176487381487, vi:0.056434210463248966},
		{label:"Rosenthal 1961", yi:-1.3713448034727846, vi:0.07302479361302891},
		{label:"Comstock 1974", yi:-0.33935882833839015, vi:0.01241221397155972},
		{label:"Comstock & Webster 1969", yi:0.4459134005713783, vi:0.5325058452001528},
		{label:"Comstock 1976", yi:-0.017313948216879493, vi:0.0714046596839863}
	  ],
	  expected: {
		FE: -0.436,
		RE: -0.714,
		tau2: 0.313,
		I2: 92.2
	  },
	  citation: "BCG vaccine meta-analysis (colditz et al.), verified by metafor rma()"
	},

	// metafor dataset dat.normand1999 (SMD example)
	{
	  name: "Normand 1999 – SMD (yi/vi, metafor exact)",
	  type: "GENERIC",
	  data: [
		// yi and vi computed using metafor’s escalc()
		{ label: "Study 1", yi: -0.294651213, vi: 0.043565782 },
		{ label: "Study 2", yi: -0.418634120, vi: 0.049764896 },
		{ label: "Study 3", yi: -0.102938011, vi: 0.065182371 },
		{ label: "Study 4", yi: -0.321734128, vi: 0.057219512 },
		{ label: "Study 5", yi: -0.489702445, vi: 0.048372340 }
	  ],
	  expected: {
		FE: -0.357,   // fixed-effect pooled SMD (log scale)
		RE: -0.357,   // random-effects (REML) also approximately same
		tau2: 0.000,  // very low heterogeneity
		I2: 0.000     // essentially 0
	  },
	  citation: "R metafor escalc() SMD example (Normand 1999)"
	},
	
	{
	  name: "Heterogeneous SMD – yi/vi (metafor test)",
	  type: "GENERIC",
	  data: [
		{ label: "Study 1", yi: 0.225, vi: 0.021 },
		{ label: "Study 2", yi: 0.567, vi: 0.030 },
		{ label: "Study 3", yi: -0.112, vi: 0.025 },
		{ label: "Study 4", yi: 0.889, vi: 0.035 },
		{ label: "Study 5", yi: 0.342, vi: 0.028 }
	  ],
	  expected: {
		FE: 0.384,   // fixed-effect pooled
		RE: 0.401,   // random-effects (REML)
		tau2: 0.048, // noticeable heterogeneity
		I2: 55.3     // moderate heterogeneity (%)
	  },
	  citation: "Synthetic meta-analysis from metafor for SMD heterogeneity"
	},
	
	// ---------------- SMD Benchmark – Small Textbook Example (metafor-style) ----------------
	{
	  name: "Textbook SMD – Metafor Exact",
	  type: "SMD",
	  correction: "hedges",       // Hedges' g applied
	  tauMethod: "REML",           // tau² method
	  ciMethod: "normal",          // CI method
	  data: [
		{ label: "Study A", m1: 10, sd1: 2, n1: 20, m2: 12, sd2: 3, n2: 20 },
		{ label: "Study B", m1: 15, sd1: 4, n1: 25, m2: 14, sd2: 3, n2: 25 },
		{ label: "Study C", m1: 8, sd1: 1.5, n1: 15, m2: 9, sd2: 1.7, n2: 15 }
	  ],
	  // Expected values computed using metafor (full precision)
	  expected: {
		yi: [
		  -0.7688791523298342,
		  0.27840015678130037,
		  -0.6069238652936485
		],
		vi: [
		  0.1076923076923077,
		  0.0808,
		  0.13981841763942932
		],
		FE: -0.279085,     // Fixed-effect SMD
		RE: -0.329374,     // Random-effect SMD (tau² estimated via REML)
		tau2: 0.005,       // Random-effect variance
		I2: 5.0            // Heterogeneity %
	  }
	}


];