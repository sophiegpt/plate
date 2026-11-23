// "How Plate works": what the numbers mean, where they come from, and what it costs.
export const ABOUT_HTML = `
<p>Plate is a running log of what you eat, with Claude doing the estimating and the coaching. Nothing is logged until you confirm it.</p>

<h2>Estimates</h2>
<ul>
  <li>Type what you had, snap a photo, or both. Claude identifies each food, estimates the portion, and works out calories, protein, carbs and fat.</li>
  <li>Photos of nutrition labels or menus with calories are read exactly. Kilojoules are converted to kcal.</li>
  <li>Name a restaurant chain or a packaged product and Claude looks up its official nutrition first (turn this off in Settings).</li>
  <li>Restaurant food is estimated with the extra oil, butter and sauce it usually carries. If an estimate is off, tell Claude ("only ate half", "it was skim milk") and it redoes it.</li>
  <li>Photo estimates are estimates. Portion size is the biggest source of error, so the confidence tag tells you how sure Claude is.</li>
</ul>

<h2>Your targets</h2>
<ul>
  <li><b>Calories</b> = your BMR (from your body scan) × an activity factor, then adjusted for your goal. Recomp is about 10% below what you burn, to lose fat while building muscle.</li>
  <li>With no BMR on the scan, Plate uses lean mass (Katch-McArdle: 370 + 21.6 × lean kg). With no scan, it uses height, weight and age (Mifflin-St Jeor).</li>
  <li><b>Protein</b> is 2.4 g per kg of lean mass while eating below what you burn (2.2 otherwise), in line with research on keeping muscle during a deficit. <b>Fat</b> is 30% of calories, never below 0.7 g per kg. <b>Carbs</b> fill the rest.</li>
  <li>On target means calories within 10% of the day's target, and protein at least 90% of yours.</li>
</ul>

<h2>Garmin</h2>
<ul>
  <li>Your activity factor already covers a normal training week, so Plate never adds your watch's calories back one for one. That would count your training twice.</li>
  <li>Instead it compares each day's active calories with your typical day (the last 4 weeks). Half the extra goes on your target, as carbs. A quiet day's target drops by half the shortfall once the day is over. Today only ever goes up, because active calories keep climbing until midnight.</li>
  <li>Wrist calorie estimates are rough: in a Stanford study of seven devices, none measured energy burned within 20%. Halving the difference keeps watch errors small.</li>
  <li>The numbers are as fresh as your watch's last sync with Garmin Connect. Open Garmin Connect to sync, then tap the Garmin row on Today to refresh.</li>
</ul>

<h2>What you really burn</h2>
<p>After 2–3 weeks of logging and a few weigh-ins, Plate compares what you ate with how your weight moved: maintenance = average intake − (weight change per day × 7,700 kcal per kg). This is the most accurate number you can get, and it corrects everything above. Weigh in at the same time of day, as water swings from salt, carbs and training blur single readings.</p>

<h2>Privacy and cost</h2>
<ul>
  <li>Your log stays on this phone. Photos and descriptions go to Anthropic with your own API key, only to be analyzed. Garmin data comes through your own relay.</li>
  <li>Each analysis is billed to your Anthropic account. By default, typed entries use Haiku 5.5 (a fraction of a cent each), and photos, scans and recaps use Sonnet 5.5 (about 2–4¢ a photo): roughly $3–4 a month. Choose different models in Settings; Settings also shows an estimate for the month.</li>
  <li>For photos, the model matters less than detail: a note like "half the rice" or "cooked in olive oil", or a photo of the label, improves an estimate more than a pricier model does.</li>
  <li>Plate is a tracking tool, not medical advice. If you have a medical condition or a history of disordered eating, set targets with a professional.</li>
</ul>

<h2>Sources</h2>
<ul class="sources">
  <li>Mifflin MD et al. (1990). A new predictive equation for resting energy expenditure. Am J Clin Nutr.</li>
  <li>Katch-McArdle lean-mass equation for basal metabolic rate.</li>
  <li>Helms ER et al. (2014). A systematic review of dietary protein during caloric restriction in resistance-trained lean athletes. Int J Sport Nutr Exerc Metab.</li>
  <li>Morton RW et al. (2018). A systematic review and meta-analysis of protein supplementation on resistance training-induced gains. Br J Sports Med.</li>
  <li>Shcherbina A et al. (2017). Accuracy in wrist-worn, sensor-based measurements of heart rate and energy expenditure in a diverse cohort. J Pers Med.</li>
</ul>`;
