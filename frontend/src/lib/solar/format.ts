// ============================================================
// Formatting: turn a SolarRecommendation into a concise, friendly
// Hindi/Hinglish WhatsApp reply, and produce the guided follow-up
// questions when data is missing. All figures use en-IN grouping.
// ============================================================

import type { SolarConfig, SolarRecommendation } from './types'

export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

/** Full quote message for a completed (bill + state) recommendation. */
export function formatQuote(
  rec: SolarRecommendation,
  config: SolarConfig,
  customerName?: string | null,
): string {
  const name = customerName?.trim() ? `${customerName.trim()} ji, ` : ''
  const stateLine = rec.input.state
    ? `\n\nState: *${rec.input.state}* (subsidy ke hisaab se calculate kiya hai)`
    : ''

  const lines = [
    `${name}namaste!`,
    `Aapke monthly consumption ~${rec.monthlyUnits} units ke hisaab se hum recommend karte hain:`,
    ``,
    `*Recommended System: ${rec.recommendedKw} kW On-Grid*`,
    ``,
    `Cost Estimate:`,
    `• System + Installation: ${inr(rec.baseCost)}`,
    `• GST (${config.gstRate}%): ${inr(rec.gstAmount)}`,
    `• Total: ${inr(rec.grossCost)}`,
    `• Subsidy (Central${rec.stateTopUp > 0 ? ' + State' : ''}): -${inr(rec.totalSubsidy)}`,
    `• *Net Payable: ${inr(rec.netPayable)}*`,
    ``,
    `Aapka monthly bill lagbhag *${inr(rec.monthlySavings)}* bach sakta hai.`,
  ]

  if (rec.paybackMonths > 0 && rec.paybackMonths < 240) {
    lines.push(`Payback period: ~${rec.paybackMonths} months.`)
  }

  lines.push(
    ``,
    `Kya aap aage badhna chahenge? Hum aapke liye detailed quotation + next steps bhej denge.`,
  )

  return lines.join('\n').replace(/\s*\n{3,}/g, '\n\n').trim() + stateLine
}

/** Sizing preview shown when we still need the state for subsidy. */
export function formatSizingOnly(
  rec: SolarRecommendation,
  config: SolarConfig,
  customerName?: string | null,
): string {
  const name = customerName?.trim() ? `${customerName.trim()} ji, ` : ''
  return [
    `${name}thank you! Aapke monthly consumption ~${rec.monthlyUnits} units ke hisaab se hum ~*${rec.recommendedKw} kW* ka on-grid system suggest karte hain.`,
    ``,
    `Iska total cost lagbhag *${inr(rec.grossCost)}* aayega (GST ke saath).`,
    ``,
    `Subsidy ka exact amount jaane ke liye bas ek baat bataiye — *aap kaunse state me rehte hain?* (jaise UP, Maharashtra, Gujarat...)`,
  ].join('\n')
}

export function askForBill(): string {
  return [
    `Namaste!`,
    `Aapke liye sahi solar system batane ke liye humein aapke monthly *electricity bill* ki zaroorat hai.`,
    ``,
    `Kripya apna monthly bill amount ya units bhejein, aur saath me apna *state* batayein (jaise UP, Maharashtra, Delhi...).`,
  ].join('\n')
}

export function askForStateOnly(): string {
  return `Subsidy ka exact amount batane ke liye bas ek baat aur chahiye — *aap kaunse state me rehte hain?* (jaise UP, Maharashtra, Rajasthan...)`
}

export function formatProcess(config: SolarConfig): string {
  const steps = (config.processSteps.length > 0 ? config.processSteps : [
    '1. Free site survey & bill verification',
    '2. Custom quotation + subsidy calculation',
    '3. Documentation & subsidy registration',
    '4. Installation, net meter & DISCOM inspection',
    '5. Commissioning + subsidy credited to bank',
  ]).join('\n')
  return [
    `Solar lagane ka pura process aisa hai:`,
    ``,
    steps,
    ``,
    `Total time: aksar 2-4 hafte. Aap sirf document sign karte hain, baaki hum sambhalte hain.`,
  ].join('\n')
}

export function formatSubsidy(
  rec: SolarRecommendation,
  customerName?: string | null,
): string {
  const name = customerName?.trim() ? `${customerName.trim()} ji, ` : ''
  return [
    `${name}subsidy ki jaankari:`,
    ``,
    `• Central (PM Surya Ghar): *${inr(rec.centralSubsidy)}*`,
    ...(rec.stateTopUp > 0
      ? [`• State top-up: *${inr(rec.stateTopUp)}*`]
      : []),
    `• Total subsidy: *${inr(rec.totalSubsidy)}*`,
    ``,
    `Subsidy seedha aapke bank account me aati hai, hum company ke through nahi. Isse aapka net cost ${inr(rec.netPayable)} ho jata hai (${inr(rec.grossCost)} - ${inr(rec.totalSubsidy)}).`,
  ].join('\n')
}
