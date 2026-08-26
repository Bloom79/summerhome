export const meta = {
  name: 'market-analysis',
  description: 'Adversarially-verified market due diligence with a weighted 6-dimension rubric, scenario ranges and comparables (reusable; pass products via args)',
  whenToUse: 'Full professional market analysis of N candidate products for a small solo venture. args: { products: [{key, name, brief}], operator?: string, verifyTop?: number, wage?: number, weights?: {income_potential, scalability, ai_resilience, home_start, time_to_cash, constraint_fit} }',
  phases: [
    { title: 'Analyse', detail: 'one market analyst per product, live web research, structured output' },
    { title: 'Verify', detail: 'adversarial fact-check of the top candidates by weighted score, claim by claim' },
  ],
}

// ---------- configuration (all overridable via args) ----------
const cfg = args || {}
const PRODUCTS = cfg.products
if (!Array.isArray(PRODUCTS) || PRODUCTS.length === 0) {
  throw new Error('args.products is required: [{key, name, brief}, …]')
}
const VERIFY_TOP = cfg.verifyTop ?? 4
const WAGE = cfg.wage ?? 45 // £/h opportunity cost of operator hours
// One rubric across screening and deep-dive so every score in the whole
// program is comparable. Weights sum to 1.
const W = cfg.weights || { income_potential:.25, scalability:.20, ai_resilience:.20, home_start:.15, time_to_cash:.10, constraint_fit:.10 }

const OPERATOR = cfg.operator || `
OPERATOR PROFILE (fixed constraints — every analysis must respect these):
- Solo founder near Edinburgh, Scotland. Expert software/AI engineer; builds sensor + control systems (Raspberry Pi, local AI vision models, automation pipelines) in days. This skill is the BREAKTHROUGH/ACCELERATOR to quantify: where does it change the economics vs a typical entrant — and where does it honestly not?
- £10,000 liquid capital, Start Up Loan capacity ~£25k, FFIS grant possibility (≤£20k at 80%, new entrants, Round 2 winter 2026). Hours priced at £${'' + (cfg.wage ?? 45)}/h.
- Infrastructure available: rented secure yard ~£360-640/month within 10 miles of Edinburgh, 20ft container buy £1,550 or hire £17/week (CS Containers, Grangemouth).
- HARD preferences: start AT HOME with minimum spend, expand through go/no-go gates; all sales through online channels (no cold calls); solo, ≤20 h/week sustained.
- Sector post-mortems are binding context: Freight Farms Ch.7 2025 (~600 units ever; Growcer rescue — no orphan market), Smallhold Ch.11 2024 (VC facilities + wholesale commodity pricing), lettuce vertical farms (energy 40-60% of opex).`

const TASK = `
You are a professional market analyst. Produce a COMPLETE, honest market analysis for the product below. Use WebSearch extensively for real, current (2026) UK/Scotland data. Cite real URLs. A rejection with evidence is a valid, valuable outcome.

MANDATORY METHOD RULES (each earned by a failure in earlier rounds):
1. MARKET SIZE CROSS-CHECK: ≥2 independent estimates; if they disagree >3x, say so and use the conservative one. Never quote a vendor headline unchecked.
2. SAM ARITHMETIC: estimate the serviceable market bottom-up with visible arithmetic (reachable buyers × purchase frequency × realistic price), not top-down percentages of a headline.
3. COMPARABLES SHEET: at least 5 live price points from named sellers with URLs (the fastest lie-detector for any revenue model).
4. FULFILMENT REALITY: real UK postage for the actual parcel (Royal Mail 2026: large letter ~£1.55-2.85 tracked; small parcel 2kg ~£3.65-5.25 by service), real marketplace fees (Etsy all-in ~13-17%), packaging, returns.
5. DEMAND ACQUISITION: current CAC benchmarks for any D2C play (supplements ~$89 blended; organic-only growth must be justified with a mechanism, not hope).
6. SCENARIOS, NOT POINT ESTIMATES: give low/base/high (p10/p50/p90) for year-3 net and mature (year 4-5) net. The base must be defensible, the low must be survivable.
7. HOURS ARE MONEY: price operator hours at £${'' + (cfg.wage ?? 45)}/h; economic_profit = year3_net_base − (hours_per_week × 48 × wage) − 450.
8. KILL QUESTION: the single question whose answer would kill this venture — answer it with searches and state whether the answer is verified.
9. REGULATORY PRECISION: check the exact product form (fruiting body vs mycelium; food vs feed; fresh vs processed). Novel Foods, FSS/council, APHA/SASA, excise, UKCA — flag any blocker explicitly.
10. PHASE-0 AT HOME: the cheapest legal home validation — cost, months, what it proves, abort criterion.

SCORING — six dimensions, 0-10, one shared calibration (use the FULL scale):
- income_potential: mature (yr 4-5) NET base case. 0 = <£10k · 3 = ~£15k · 5 = ~£25k · 8 = £60k · 10 = £100k+ credible.
- scalability: revenue decoupling from founder hours. 0 = pure hours-for-money · 5 = batch/machine leverage but founder-bound · 8 = digital/partner/multi-site layers proven in precedent · 10 = near-zero marginal hours.
- ai_resilience: 5-10yr immunity to AI/software/robots/imports. 0 = pure information work · 5 = physical but commoditizable/importable · 8 = perishable-local-living-craft-trust · 10 = biological asset + place + trust.
- home_start: 0 = impossible at home or >£5k · 5 = ~£1.5k, 6 months · 10 = <£500 and <3 months, fully legal.
- time_to_cash: 10 = <8 weeks · 7 = ~3-4 months · 5 = ~6 months · 2 = ~1 year · 0 = >18 months.
- constraint_fit: solo + online-only channels + Scottish climate/regulatory fit. A fatal blocker → regulatory_blocker=true AND fit ≤2.

Cover everything in the schema. Your final output is data for a synthesis step, not prose.`

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['key','product','market_summary','market_size_uk','market_size_cross_check','sam_estimate','demand_evidence','channels_online','comparables','competition_notes','barriers','regulatory','regulatory_blocker','capex_breakdown','unit_economics','time_to_first_revenue_weeks','scenarios','hours_per_week','economic_profit_gbp','phase0_home','staging','ai_leverage','ai_leverage_limits','kill_question','risks','scores','verdict','sources'],
  properties: {
    key: {type:'string'},
    product: {type:'string'},
    market_summary: {type:'string', description:'2-3 sentences with numbers'},
    market_size_uk: {type:'string', description:'UK size/growth with figures and sources'},
    market_size_cross_check: {type:'string', description:'second independent estimate; agreement or divergence stated'},
    sam_estimate: {type:'string', description:'bottom-up serviceable market with visible arithmetic'},
    demand_evidence: {type:'array', items:{type:'string'}, description:'concrete demand signals, each with source'},
    channels_online: {type:'array', items:{type:'string'}, description:'specific no-call channels with names/URLs'},
    comparables: {type:'array', minItems:5, items:{type:'object', required:['seller','item','price','url'], properties:{seller:{type:'string'}, item:{type:'string'}, price:{type:'string'}, url:{type:'string'}}}},
    competition_notes: {type:'string'},
    barriers: {type:'string'},
    regulatory: {type:'string', description:'full UK/Scotland chain for this exact product form'},
    regulatory_blocker: {type:'boolean'},
    capex_breakdown: {type:'string', description:'itemised, staged, within the capital plan'},
    unit_economics: {type:'string', description:'costs, prices, margins, real fulfilment costs, arithmetic shown'},
    time_to_first_revenue_weeks: {type:'number'},
    scenarios: {type:'object', required:['y3_low','y3_base','y3_high','mature_low','mature_base','mature_high'],
      properties:{y3_low:{type:'number'},y3_base:{type:'number'},y3_high:{type:'number'},mature_low:{type:'number'},mature_base:{type:'number'},mature_high:{type:'number'}},
      description:'net £ p10/p50/p90 for year 3 and mature (yr 4-5)'},
    hours_per_week: {type:'number', description:'sustained, steady state'},
    economic_profit_gbp: {type:'number', description:'y3_base − hours×48×wage − 450'},
    phase0_home: {type:'object', required:['cost_gbp','months','what_it_proves','home_legal','abort_criterion'], properties:{cost_gbp:{type:'number'}, months:{type:'number'}, what_it_proves:{type:'string'}, home_legal:{type:'string'}, abort_criterion:{type:'string'}}},
    staging: {type:'string', description:'gated expansion path with per-gate spend and abort criteria'},
    ai_leverage: {type:'string', description:'where the operator skill changes the economics, quantified'},
    ai_leverage_limits: {type:'string', description:'binding constraints the skill can NOT touch'},
    kill_question: {type:'object', required:['question','answer','verified'], properties:{question:{type:'string'}, answer:{type:'string'}, verified:{type:'boolean'}}},
    risks: {type:'array', items:{type:'string'}},
    scores: {type:'object', required:['income_potential','scalability','ai_resilience','home_start','time_to_cash','constraint_fit'],
      properties:{income_potential:{type:'number'},scalability:{type:'number'},ai_resilience:{type:'number'},home_start:{type:'number'},time_to_cash:{type:'number'},constraint_fit:{type:'number'}}},
    verdict: {type:'string', description:'3-6 sentences, honest'},
    sources: {type:'array', items:{type:'string'}},
  }
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['key','challenged_claims','kill_question_check','revised_scores','revised_scenarios','notes'],
  properties: {
    key: {type:'string'},
    challenged_claims: {type:'array', items:{type:'object', required:['claim','verdict','evidence'], properties:{
      claim:{type:'string'}, verdict:{type:'string', enum:['holds','weak','refuted']}, evidence:{type:'string', description:'what fresh search found, with URL'},
      corrected_value:{type:'string', description:'if refuted/weak: the corrected number or fact'}}}},
    kill_question_check: {type:'string', description:'independent re-answer of the analysis kill question'},
    revised_scores: {type:'object', required:['income_potential','scalability','ai_resilience','home_start','time_to_cash','constraint_fit'],
      properties:{income_potential:{type:'number'},scalability:{type:'number'},ai_resilience:{type:'number'},home_start:{type:'number'},time_to_cash:{type:'number'},constraint_fit:{type:'number'}},
      description:'the six rubric scores after your corrections'},
    revised_scenarios: {type:'object', required:['y3_base','mature_base'], properties:{y3_base:{type:'number'}, mature_base:{type:'number'}}},
    notes: {type:'string'},
  }
}

const weighted = (s) => +Object.entries(W).reduce((t,[k,w])=>t+w*((s&&s[k])||0),0).toFixed(2)

// ---------- phase 1: analyse ----------
phase('Analyse')
log('Launching ' + PRODUCTS.length + ' market analysts…')
const analyses = (await parallel(PRODUCTS.map(p => () =>
  agent(OPERATOR + '\n' + TASK + '\n\nPRODUCT TO ANALYSE: ' + p.name + '\nContext: ' + p.brief + '\nSet key to "' + p.key + '".',
    { label: 'analyse:' + p.key, phase: 'Analyse', schema: ANALYSIS_SCHEMA })
))).filter(Boolean)
for (const a of analyses) {
  a.weighted = weighted(a.scores)
  if (a.regulatory_blocker) a.weighted = Math.min(a.weighted, 2.5)
}
const ranked = analyses.slice().sort((a, b) => b.weighted - a.weighted)
log(analyses.length + '/' + PRODUCTS.length + ' analyses complete. Weighted order: ' + ranked.map(a => a.key + ' ' + a.weighted).join(', '))

// ---------- phase 2: adversarial verification (chosen by weighted score, not self-grade) ----------
phase('Verify')
const top = ranked.slice(0, VERIFY_TOP)
const verifications = (await parallel(top.map(a => () =>
  agent(OPERATOR + `
You are an adversarial fact-checker. Below is a market analysis another analyst produced. Try to REFUTE its 5 most load-bearing claims — the numbers and assertions the verdict and scores depend on (comparable prices, market/SAM sizing, regulatory status, fulfilment costs, time-to-revenue, the scenario bases, the AI-leverage quantification). For each: run fresh WebSearches, state what you found with a URL, rule holds/weak/refuted, and where refuted/weak give the corrected value. Independently re-answer the kill question. Then restate the SIX rubric scores and the y3/mature base scenarios as they stand AFTER your corrections (calibration: income 0=<£10k, 5=~£25k, 8=£60k, 10=£100k+; scalability 0=hours-for-money, 10=near-zero marginal hours; ai_resilience 8=perishable-local-craft-trust; home_start 10=<£500 <3mo; time_to_cash 10=<8wk; fit: blocker→≤2). Set key to "` + a.key + `".

ANALYSIS UNDER REVIEW:
` + JSON.stringify(a),
    { label: 'verify:' + a.key, phase: 'Verify', schema: VERIFY_SCHEMA })
))).filter(Boolean)
for (const v of verifications) v.revised_weighted = weighted(v.revised_scores)
log('Verification complete on ' + verifications.length + ' candidates')

return { ranked, verifications, config: { weights: W, verifyTop: VERIFY_TOP, wage: WAGE, productCount: PRODUCTS.length } }
