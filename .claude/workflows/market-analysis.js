export const meta = {
  name: 'market-analysis',
  description: 'Adversarially-verified market due diligence with a weighted 6-dimension rubric, scenario ranges and comparables (reusable; pass products via args)',
  whenToUse: 'Full professional market analysis of N candidate products for a small solo venture. args: { products: [{key, name, brief}], operator?: string, verifyTop?: number, wage?: number, weights?: {income_potential, scalability, ai_resilience, home_start, time_to_cash, constraint_fit} }',
  phases: [
    { title: 'Gate', detail: 'cheap kill-tests first (commodity appliance + fatal regulatory) so dead candidates never get a full analysis', model: 'sonnet' },
    { title: 'Analyse', detail: 'one market analyst per surviving product, live web research, structured output', model: 'opus' },
    { title: 'Verify', detail: 'adversarial fact-check of the top candidates by weighted score, claim by claim', model: 'opus' },
    { title: 'Synthesis', detail: 'one judge reads everything: cross-ranking, synergies, the honest recommendation', model: 'opus' },
  ],
}

// ---------- verified facts bank (distilled from analyses/facts.json — update BOTH together) ----------
const FACTS = `
VERIFIED FACTS BANK (do not re-derive; correct an analyst only if a fresh OFFICIAL source contradicts these):
- Postage UK 2026: large letter £1.55 untracked / £2.85 Tracked48; small parcel 2kg £3.65-5.25; 2-5kg Evri £2.62-6.59; 10kg courier £5.39-6.45 business rates. Live animals: ONLY Royal Mail (enumerated invertebrates); Etsy/Amazon ban live animals, eBay allows.
- Fees: Etsy all-in ~13-17% (+0.48% reg fee from Jun 2026). Amazon Grocery gated; GS1-registered GTIN required (~£99+VAT/yr); FBA needs ~105 days shelf life.
- CAC: cold D2C food £12-28 blended vs ~£8 first-order margin (structurally unprofitable paid); supplements ~$89. Coffee subs churn 5-10%/mo. Median YouTube channel: 15.5 months to 1k subs.
- Scotland regs: food registration free, 28 days, per-premises, CookSafe not SFBB, FHIS Pass/IR. Animal-origin products need premises APPROVAL; pet food needs FSS feed reg + APHA approval BEFORE first sale. Plant distance-selling needs SASA operator reg (free) + passport authorisation (~£120-250/yr); birch/oak logs exempt. Invertebrates outside pet-licensing (s.16 AHWSA 2006). Honey name reserved (Honey (Scotland) Regs 2015). Mead/made-wine excise kills home phase-0. Mycelium powders and cordyceps = illegal novel foods; fruiting-body powder legal; zero authorised health claims for mushrooms.
- Finance: FFIS ≤£20k at 80% (winter 2026, competitive, upside never plan); Start Up Loan ≤£25k @7.5%/5yr; VAT £90k; trading allowance £1k.
- Verified market sizes: UK functional-mushroom supplements ~£100-200m (headlines 10x inflated); grow kits £8-15m (logs £1-3m); fresh wasabi 3-6t/yr; black garlic ~£5m (artisan online £0.3-0.7m); craft koji <£2m; farmed snails £0.5-1m. Oyster wholesale £6.92/kg flat; growers net £9-13 restaurants, £12-20 direct.
- Post-mortems: Freight Farms (~600 units, no orphan market, cloud death), Smallhold (wholesale trap → partner network), vertical lettuce (energy 40-60% opex; fungi 2.2kWh/kg escape), Mara Seaweed exit, both UK edible-flower flagships exited 2025-26, Sow Good -88% (freeze-dried window closed).
- Operator verified: fungi labor 1h/kg → 0.3h/kg; contamination 15%→5%; solo mature £26k, multi-site £58k Y5 cred 5/10; 20ft £1,550/£17wk; yards £360-640/mo.
- Commodity appliances (process already solved cheap — voids any "stack advantage" claim): black-garlic fermenters €70-150, biltong boxes £60-150, yogurt/natto incubators €30-60, dehydrators, proofing boxes, reptile/aquarium thermostats, Inkbird PID ~£20. If a ≤€300 appliance produces substantially the same outcome for an untrained buyer, the operator's edge must come from something ELSE (scale economics, labor at volume, regulatory moat, demand access) or the candidate fails.`

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

const OPERATOR_FULL = OPERATOR + '\n' + FACTS

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
11. MEASURED DEMAND, NOT ESTIMATED: check eBay UK SOLD listings count and Etsy review velocity for the exact product class — real transactions beat any report. State what you found.
12. INCUMBENT COST STRUCTURE: decompose a typical incumbent's cost/failure structure into lines with % and source (fill incumbent_cost_structure). The process-advantage index = which lines the operator's sense-decide-act stack removes, and how much of total cost that is.
13. COMMODITY-APPLIANCE TEST (kill criterion — earned by the black-garlic fermenter miss): before crediting the operator's sensor/AI stack with ANY advantage, actively search Amazon/AliExpress/eBay/specialist shops for consumer or prosumer appliances and controllers that ALREADY solve the process bottleneck (examples that killed earlier claims: black-garlic fermenters €70-150, biltong boxes £60-150, yogurt/natto incubators €30-60, £20 Inkbird PID controllers, proofing boxes, reptile thermostats). If an appliance at ≤€300 lets an untrained person get substantially the same outcome, the process advantage is VOID: fill commodity_appliance_check with the machine and its live price+URL, score ai_leverage honestly as ~zero, and the venture must then stand on a DIFFERENT verified edge (scale economics the appliance cannot reach, labor at volume the appliance doesn't remove, regulatory moat, demand access) or be rejected. "The machine exists but mine has sensors" is NOT an edge.

SCORING — six dimensions, 0-10, one shared calibration (use the FULL scale):
- income_potential: mature (yr 4-5) NET base case. 0 = <£10k · 3 = ~£15k · 5 = ~£25k · 8 = £60k · 10 = £100k+ credible.
- scalability: revenue decoupling from founder hours. 0 = pure hours-for-money · 5 = batch/machine leverage but founder-bound · 8 = digital/partner/multi-site layers proven in precedent · 10 = near-zero marginal hours.
- ai_resilience: 5-10yr immunity to AI/software/robots/imports. 0 = pure information work · 5 = physical but commoditizable/importable · 8 = perishable-local-living-craft-trust · 10 = biological asset + place + trust.
- home_start: 0 = impossible at home or >£5k · 5 = ~£1.5k, 6 months · 10 = <£500 and <3 months, fully legal.
- time_to_cash: 10 = <8 weeks · 7 = ~3-4 months · 5 = ~6 months · 2 = ~1 year · 0 = >18 months.
- constraint_fit: solo + online-only channels + Scottish climate/regulatory fit. A fatal blocker → regulatory_blocker=true AND fit ≤2.

TOKEN DISCIPLINE (costs are real): the gate phase already ran the commodity-appliance test — build on its result, do NOT repeat those searches. Never re-verify anything the FACTS BANK answers. Prefer ~12-18 high-value searches over exhaustive sweeps; stop searching a rule the moment it is satisfied. Keep prose fields tight.

Cover everything in the schema. Your final output is data for a synthesis step, not prose.`

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['key','product','market_summary','market_size_uk','market_size_cross_check','sam_estimate','demand_evidence','channels_online','comparables','competition_notes','barriers','regulatory','regulatory_blocker','capex_breakdown','unit_economics','time_to_first_revenue_weeks','scenarios','hours_per_week','economic_profit_gbp','phase0_home','staging','ai_leverage','ai_leverage_limits','kill_question','incumbent_cost_structure','commodity_appliance_check','risks','scores','verdict','sources'],
  properties: {
    key: {type:'string'},
    product: {type:'string'},
    market_summary: {type:'string', description:'2-3 sentences with numbers'},
    market_size_uk: {type:'string', description:'UK size/growth with figures and sources'},
    market_size_cross_check: {type:'string', description:'second independent estimate; agreement or divergence stated'},
    sam_estimate: {type:'string', description:'bottom-up serviceable market with visible arithmetic'},
    demand_evidence: {type:'array', maxItems:6, items:{type:'string'}, description:'concrete demand signals, each with source'},
    channels_online: {type:'array', maxItems:6, items:{type:'string'}, description:'specific no-call channels with names/URLs'},
    comparables: {type:'array', minItems:5, maxItems:7, items:{type:'object', required:['seller','item','price','url'], properties:{seller:{type:'string'}, item:{type:'string'}, price:{type:'string'}, url:{type:'string'}}}},
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
    incumbent_cost_structure: {type:'array', items:{type:'object', required:['line','pct','removable_by_stack','source'], properties:{line:{type:'string'}, pct:{type:'number'}, removable_by_stack:{type:'boolean'}, source:{type:'string'}}}, description:'typical incumbent cost/failure lines summing to ~100%'},
    commodity_appliance_check: {type:'object', required:['searched','found','verdict'], properties:{searched:{type:'string', description:'which appliance/controller searches were run'}, found:{type:'string', description:'best appliance found with live price and URL, or "none"'}, verdict:{type:'string', enum:['void','partial','clear'], description:'void = a ≤€300 appliance already solves the bottleneck; partial = solves part of it; clear = no appliance solves it'}}},
    risks: {type:'array', maxItems:6, items:{type:'string'}},
    scores: {type:'object', required:['income_potential','scalability','ai_resilience','home_start','time_to_cash','constraint_fit'],
      properties:{income_potential:{type:'number'},scalability:{type:'number'},ai_resilience:{type:'number'},home_start:{type:'number'},time_to_cash:{type:'number'},constraint_fit:{type:'number'}}},
    verdict: {type:'string', description:'3-6 sentences, honest'},
    sources: {type:'array', maxItems:12, items:{type:'string'}},
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
// ---------- phase 0: cheap kill-gate (never pay a full analysis for a dead candidate) ----------
phase('Gate')
const GATE_SCHEMA = {
  type:'object', required:['key','appliance_found','appliance_verdict','regulatory_fatal','proceed','reason'],
  properties:{
    key:{type:'string'},
    appliance_found:{type:'string', description:'best consumer appliance/controller ≤€300 that solves the process bottleneck, with live price + URL, or "none"'},
    appliance_verdict:{type:'string', enum:['void','partial','clear']},
    regulatory_fatal:{type:'string', description:'likely fatal blocker for home production + online sale in Scotland, or "none"'},
    proceed:{type:'boolean'},
    reason:{type:'string', description:'one or two sentences'},
  }
}
log('Gate: cheap kill-tests on ' + PRODUCTS.length + ' candidates…')
const gates = (await parallel(PRODUCTS.map(p => () =>
  agent(OPERATOR_FULL + `
You are a fast kill-gate, not a full analyst. TWO checks only, ≤10 targeted searches total, be economical:
1. COMMODITY-APPLIANCE TEST: search Amazon/AliExpress/eBay for a consumer appliance or controller ≤€300 that already solves this product's process bottleneck for an untrained buyer. Name the best find with live price + URL.
2. FATAL REGULATORY: any likely fatal blocker for home production + online sale in Scotland (excise, premises-approval walls)? Use the facts bank; do not re-research what it already answers.
proceed=false ONLY when the appliance verdict is void AND the brief names no other credible edge (scale economics, labor at volume, regulatory moat, demand access), or when regulation is fatal. When in doubt, proceed=true — the full analysis decides.
PRODUCT: ` + p.name + '\nBRIEF: ' + p.brief + '\nSet key to "' + p.key + '".',
    { label: 'gate:' + p.key, phase: 'Gate', schema: GATE_SCHEMA, model: 'sonnet', effort: 'low' })
))).filter(Boolean)
const gateByKey = Object.fromEntries(gates.map(g => [g.key, g]))
const killedAtGate = gates.filter(g => !g.proceed)
const survivors = PRODUCTS.filter(p => !gateByKey[p.key] || gateByKey[p.key].proceed)
log('Gate: ' + gates.map(g => g.key + ':' + (g.proceed ? 'pass' : 'KILL')).join(', '))

phase('Analyse')
log('Launching ' + survivors.length + ' market analysts (' + killedAtGate.length + ' killed at gate)…')
const analyses = (await parallel(survivors.map(p => () =>
  agent(OPERATOR_FULL + '\n' + TASK + '\n\nPRODUCT TO ANALYSE: ' + p.name + '\nContext: ' + p.brief + '\nGATE RESULT (appliance test already run — build on it, do not repeat it): ' + JSON.stringify(gateByKey[p.key] || {}) + '\nSet key to "' + p.key + '".',
    { label: 'analyse:' + p.key, phase: 'Analyse', schema: ANALYSIS_SCHEMA, model: 'opus', effort: 'medium' })
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
  agent(OPERATOR_FULL + `
You are an adversarial fact-checker. Below is a market analysis another analyst produced. Try to REFUTE its 5 most load-bearing claims — the numbers and assertions the verdict and scores depend on (comparable prices, market/SAM sizing, regulatory status, fulfilment costs, time-to-revenue, the scenario bases, the AI-leverage quantification). For each: run fresh WebSearches, state what you found with a URL, rule holds/weak/refuted, and where refuted/weak give the corrected value. Independently re-answer the kill question. Independently RE-RUN THE COMMODITY-APPLIANCE TEST: search Amazon/AliExpress/eBay for consumer appliances or controllers ≤€300 that already solve the claimed process bottleneck — finding one the analysis missed REFUTES its ai_leverage claim; correct the scores accordingly. Then restate the SIX rubric scores and the y3/mature base scenarios as they stand AFTER your corrections (calibration: income 0=<£10k, 5=~£25k, 8=£60k, 10=£100k+; scalability 0=hours-for-money, 10=near-zero marginal hours; ai_resilience 8=perishable-local-craft-trust; home_start 10=<£500 <3mo; time_to_cash 10=<8wk; fit: blocker→≤2). Set key to "` + a.key + `".

ANALYSIS UNDER REVIEW:
` + JSON.stringify(a),
    { label: 'verify:' + a.key, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
))).filter(Boolean)
for (const v of verifications) v.revised_weighted = weighted(v.revised_scores)
log('Verification complete on ' + verifications.length + ' candidates')

// ---------- phase 3: synthesis judge ----------
phase('Synthesis')
const SYNTH_SCHEMA = {
  type:'object', required:['final_ranking','synergies','recommendation','what_would_change_it'],
  properties:{
    final_ranking:{type:'array', items:{type:'object', required:['key','final_score','one_line'], properties:{key:{type:'string'}, final_score:{type:'number'}, one_line:{type:'string'}}}},
    synergies:{type:'array', items:{type:'string'}, description:'cross-candidate combinations worth more than the parts (shared infrastructure, shared customers, shared skills)'},
    recommendation:{type:'string', description:'the honest 5-8 sentence recommendation across ALL candidates in this round, incl. against the incumbent #1 from prior rounds'},
    what_would_change_it:{type:'array', items:{type:'string'}, description:'the 2-4 facts that, if different, would flip this recommendation'},
  }
}
const synthesis = await agent(OPERATOR_FULL + `
You are the synthesis judge. Read every analysis and every verification below TOGETHER. Deliver: a final cross-ranking (use revised scores where verified), the synergies between candidates (shared infrastructure, customers, skills — combinations worth more than parts), and one honest recommendation for this operator including how this round's best compares to the standing #1 from prior rounds (the fungi stack, solo £26k / multi-site £58k Y5). Name what would change your mind.

ANALYSES (slimmed — sources/comparable rows omitted, numbers kept):
` + JSON.stringify(ranked.map(a => { const { comparables, sources, demand_evidence, channels_online, ...rest } = a; return rest })) + `

VERIFICATIONS:
` + JSON.stringify(verifications),
  { label:'synthesis', phase:'Synthesis', schema: SYNTH_SCHEMA, model: 'opus' })

return { ranked, verifications, synthesis, gate: gates, killed_at_gate: killedAtGate.map(g => ({ key: g.key, reason: g.reason })), config: { weights: W, verifyTop: VERIFY_TOP, wage: WAGE, productCount: PRODUCTS.length, analysed: survivors.length } }
