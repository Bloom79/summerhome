export const meta = {
  name: 'market-analysis',
  description: 'Adversarially-verified market due diligence on candidate products/ventures (reusable; pass products via args)',
  whenToUse: 'Full professional market analysis of N candidate products for a small solo venture. args: { products: [{key, name, brief}], operator?: string, verifyTop?: number, wage?: number }',
  phases: [
    { title: 'Analyse', detail: 'one market analyst per product, live web research, structured output' },
    { title: 'Verify', detail: 'adversarial fact-check of the top candidates, claim by claim' },
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

const OPERATOR = cfg.operator || `
OPERATOR PROFILE (fixed constraints — every analysis must respect these):
- Solo founder near Edinburgh, Scotland. Expert software/AI engineer; builds sensor + control systems (Raspberry Pi, local AI vision models, automation pipelines) in days. This skill is the BREAKTHROUGH/ACCELERATOR to quantify: where does it change the economics vs a typical entrant — and where does it honestly not?
- £10,000 liquid capital. Benchmark: cash ISA ~4.5%/yr (£450 at zero hours) PLUS operator hours priced at £${'' + (cfg.wage ?? 45)}/h. A venture is only rational if year-3 net exceeds hours×wage + £450, or if it buys something non-financial the operator explicitly values.
- Infrastructure available: rented secure yard ~£360-640/month within 10 miles of Edinburgh (live Gumtree listings verified Aug 2026), 20ft container buy £1,550 or hire £17/week (CS Containers, Grangemouth). FFIS grant (gov.scot): up to £20k at 80% intervention for new entrants, Round 2 winter 2026.
- HARD preferences: all sales through online channels (platforms, marketplaces, email with price list) — no cold calls, minimal human contact. Solo operation, under ~20 h/week sustained.
- Sector post-mortems already studied and to be engaged with, not ignored: Freight Farms Ch.7 2025 (sold $150k boxes to unprofitable buyers; ~600 units ever sold; Growcer kept the software alive — there is NO large orphan market), Smallhold Ch.11 2024 (VC-scale facilities + wholesale commodity pricing), lettuce vertical farms (energy 40-60% of opex).
- Already analysed and settled in a previous round (do NOT re-analyse): fresh gourmet mushrooms, lion's mane powder brand, mushroom grow kits, plant tissue culture, wasabi, oyster leaf/coastal herbs, saffron, insect feed, microgreens, grow controller. Retained side-bets: Mertensia propagation experiment + open-core controller.`

const TASK = `
You are a professional market analyst. Produce a COMPLETE, honest market analysis for the product below as a candidate for this operator's investment. Use WebSearch extensively for real, current (2026) UK/Scotland data. Cite real URLs. A rejection with evidence is a valid, valuable outcome.

LESSONS FROM THE PREVIOUS ROUND — these are now mandatory method rules:
1. MARKET SIZE CROSS-CHECK: never rely on one market-research headline. Find at least 2 independent estimates; if they disagree by more than 3x, say so and use the conservative one. (A previous analyst's $1.85bn figure turned out ~10x inflated.)
2. FULFILMENT REALITY: for any e-commerce channel, price REAL UK postage for the actual parcel weight/size (a 2.5kg box is ~£5-5.50, not £3.65), real marketplace fees (Etsy all-in ~13%), packaging, and returns.
3. DEMAND ACQUISITION: for any D2C brand play, use current customer-acquisition benchmarks (D2C supplements ~$89/customer blended, Meta 'sensitive categories' restrictions) — organic-only growth claims must be justified.
4. NAME REAL COMPETITORS: at least 3, with their actual live prices and URLs. If you cannot find 3, that is evidence about market size — say which way it cuts.
5. HOURS ARE MONEY: price operator hours at £${'' + (cfg.wage ?? 45)}/h. Compute economic_profit = year3_net − (hours_per_week × 48 × wage) − 450. Report it. Negative is not automatically fatal but must be stated plainly.
6. KILL QUESTION: state the single question whose answer would kill this venture, answer it with searches, and report whether the answer is verified.
7. REGULATORY PRECISION: check the exact product form (e.g. fruiting body vs mycelium; fresh vs processed; food vs feed vs cosmetic). UK Novel Foods, FSS/council registration, APHA/SASA, licensing, UKCA — whatever applies. Flag any blocker explicitly.
8. USE THE FULL SCORING SCALE: in the previous round nothing honest scored above 5. If this product genuinely beats the benchmark, say so with a 7-8; if it is a value-destroyer, score it 2-3. Do not cluster at the middle out of caution.

Cover: market definition and UK size/growth (cross-checked); demand evidence; online-only channels available to a Scottish micro-producer; competition and barriers; full regulatory chain; itemised capex within ~£10k; unit economics with arithmetic; time to first revenue; realistic year-1 and year-3 NET for a solo operator; economic profit vs benchmark; where specifically the operator's AI/automation skill changes the economics (quantified honestly — including where it does NOT); risks and failure modes referencing the sector post-mortems where relevant; the kill question; scores; verdict. Your final output is data for a synthesis step, not prose.`

const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['key','product','market_summary','market_size_uk','market_size_cross_check','demand_evidence','channels_online','competitors','competition_notes','barriers','regulatory','regulatory_blocker','capex_breakdown','unit_economics','time_to_first_revenue_weeks','year1_net_gbp','year3_net_gbp','hours_per_week','economic_profit_gbp','ai_leverage','ai_leverage_limits','kill_question','risks','scores','verdict','sources'],
  properties: {
    key: {type:'string'},
    product: {type:'string'},
    market_summary: {type:'string', description:'2-3 sentences with numbers'},
    market_size_uk: {type:'string', description:'UK size/growth with figures and sources'},
    market_size_cross_check: {type:'string', description:'second independent estimate; agreement or divergence stated'},
    demand_evidence: {type:'array', items:{type:'string'}, description:'concrete demand signals, each with source'},
    channels_online: {type:'array', items:{type:'string'}, description:'specific no-call channels with names/URLs'},
    competitors: {type:'array', items:{type:'object', required:['name','price','url'], properties:{name:{type:'string'}, price:{type:'string'}, url:{type:'string'}}}},
    competition_notes: {type:'string'},
    barriers: {type:'string'},
    regulatory: {type:'string', description:'full UK/Scotland chain for this exact product form'},
    regulatory_blocker: {type:'boolean'},
    capex_breakdown: {type:'string', description:'itemised within ~£10k'},
    unit_economics: {type:'string', description:'costs, prices, margins, real fulfilment costs, arithmetic shown'},
    time_to_first_revenue_weeks: {type:'number'},
    year1_net_gbp: {type:'number'},
    year3_net_gbp: {type:'number'},
    hours_per_week: {type:'number', description:'sustained, steady state'},
    economic_profit_gbp: {type:'number', description:'year3_net − hours×48×wage − 450'},
    ai_leverage: {type:'string', description:'where the operator skill changes the economics, quantified'},
    ai_leverage_limits: {type:'string', description:'binding constraints the skill can NOT touch'},
    kill_question: {type:'object', required:['question','answer','verified'], properties:{question:{type:'string'}, answer:{type:'string'}, verified:{type:'boolean'}}},
    risks: {type:'array', items:{type:'string'}},
    scores: {type:'object', required:['profitability','feasibility_10k','online_only','solo_operability','time_to_cash','ai_leverage','overall'],
      properties:{profitability:{type:'number'},feasibility_10k:{type:'number'},online_only:{type:'number'},solo_operability:{type:'number'},time_to_cash:{type:'number'},ai_leverage:{type:'number'},overall:{type:'number'}}},
    verdict: {type:'string', description:'3-6 sentences incl. how it fares vs the benchmark'},
    sources: {type:'array', items:{type:'string'}},
  }
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['key','challenged_claims','kill_question_check','revised_overall','notes'],
  properties: {
    key: {type:'string'},
    challenged_claims: {type:'array', items:{type:'object', required:['claim','verdict','evidence'], properties:{
      claim:{type:'string'}, verdict:{type:'string', enum:['holds','weak','refuted']}, evidence:{type:'string', description:'what fresh search found, with URL'}}}},
    kill_question_check: {type:'string', description:'independent re-answer of the analysis kill question'},
    revised_overall: {type:'number'},
    notes: {type:'string'},
  }
}

// ---------- phase 1: analyse ----------
phase('Analyse')
log('Launching ' + PRODUCTS.length + ' market analysts…')
const analyses = (await parallel(PRODUCTS.map(p => () =>
  agent(OPERATOR + '\n' + TASK + '\n\nPRODUCT TO ANALYSE: ' + p.name + '\nContext: ' + p.brief + '\nSet key to "' + p.key + '".',
    { label: 'analyse:' + p.key, phase: 'Analyse', schema: ANALYSIS_SCHEMA })
))).filter(Boolean)
log(analyses.length + '/' + PRODUCTS.length + ' analyses complete')

const ranked = analyses.slice().sort((a, b) => b.scores.overall - a.scores.overall)
const top = ranked.slice(0, VERIFY_TOP)
log('Verifying top ' + top.length + ': ' + top.map(a => a.key + ' (' + a.scores.overall + ')').join(', '))

// ---------- phase 2: adversarial verification ----------
phase('Verify')
const verifications = (await parallel(top.map(a => () =>
  agent(OPERATOR + `
You are an adversarial fact-checker. Below is a market analysis another analyst produced. Try to REFUTE its 5 most load-bearing claims — the numbers and assertions the verdict depends on (prices, market size, regulatory status, fulfilment costs, time-to-revenue, year-1/3 net, the AI-leverage quantification). For each: run fresh WebSearches, state what you found with a URL, rule holds/weak/refuted; default to 'weak' when evidence is thin. Independently re-answer the analysis's kill question. Then give a revised overall score 0-10. Set key to "` + a.key + `".

ANALYSIS UNDER REVIEW:
` + JSON.stringify(a),
    { label: 'verify:' + a.key, phase: 'Verify', schema: VERIFY_SCHEMA })
))).filter(Boolean)
log('Verification complete on ' + verifications.length + ' candidates')

return { ranked, verifications, config: { verifyTop: VERIFY_TOP, wage: WAGE, productCount: PRODUCTS.length } }
