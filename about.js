/* TASC Connect · About: a short field guide (opens from the logo in the header, or Profile → About TASC Connect). */

function aboutHTML() {
  const ch = (n, kicker, title, body) => `<section class="ab-ch"><div class="ab-num">${n}</div><div class="ab-body"><div class="ab-kicker">${kicker}</div><h3>${title}</h3>${body}</div></section>`;
  return `<article class="ab">
  <header class="ab-hero">
    <img src="icon-192.png" alt="" class="ab-icon">
    <h2>TASC Connect</h2>
    <p class="ab-dek">A short field guide to visiting the places allotted to you, and keeping a record of every visit.</p>
  </header>

  ${ch('I', 'The idea', 'Every allotted place, visited and on record', `
    <p class="ab-lede">TASC Connect holds the list of Trusts, Associations, Societies, Clubs and other institutions the Regional Office wants visited, plus any place you add yourself. Each is allotted to someone with a date. You go, submit a visit report with a few photos, and the Regional Office checks it and sees the whole region at a glance.</p>
    <blockquote>One visit leads to the next. Set a follow-up date and it shows under Follow-ups due in My visits.</blockquote>`)}

  ${ch('II', 'Getting in', 'Your name, or Google', `
    <div class="ab-chain"><span>Sign in with your name<br><small>name + date of birth</small></span><i>or</i><span>Sign in with Google<br><small>any phone</small></span></div>
    <p>With your name, you confirm your Emp ID, branch and the last digits of your mobile once, and that phone stays signed in. Google works the same on any phone. Admins use Google for the Admin tab.</p>
    <p>Every phone and Gmail that opens your profile is listed in <b>Profile</b>. Remove any you don't recognise, and tell the Regional Office.</p>`)}

  ${ch('III', 'A visit, start to finish', 'Six steps', `
    <ol class="ab-steps">
      <li><b>Open</b><span>Visits → My visits lists your allotted places and reports. Tap Overdue or Today to see what is due.</span></li>
      <li><b>Go</b><span>Find on Maps takes you there. A note from the Regional Office, if any, is at the top of the place.</span></li>
      <li><b>Report</b><span>Submit Visit Report: who you met, their banking, the potential and what came of it.</span></li>
      <li><b>Photograph</b><span>Up to four. Photos taken in TASC Connect are stamped and pin the place on the map.</span></li>
      <li><b>Verify</b><span>The Regional Office checks your report.</span></li>
      <li><b>Follow up</b><span>Once verified, add Visit 2, 3… or close it: account opened, rejected or not feasible.</span></li>
    </ol>
    <p>Visiting somewhere not on your list? Find it in <b>Places</b>, or add it there.</p>`)}

  ${ch('IV', 'Who sees what', 'Four kinds of user', `
    <div class="ab-legend">
      <div><i class="ab-dot ver"></i><b>Staff</b><span>Their own allotments and reports in full, and a short summary of everyone's visits to a place: who went, when, what came of it.</span></div>
      <div><i class="ab-dot vis"></i><b>Branch heads</b><span>All of that, plus <b>My Staff Visits</b>: their branch staff's allotments and reports in one place, with overdue counts and a Call or WhatsApp button.</span></div>
      <div><i class="ab-dot due"></i><b>Viewers</b><span>Everything staff can do, plus the <b>Dashboard</b> for the whole region: progress, overdue, business, branches and officers, every visit report, the summary image and Excel. They can look, not change anyone else's work.</span></div>
      <div><i class="ab-dot over"></i><b>Admin</b><span>The Regional Office: allots places, verifies reports, answers requests and manages who can sign in.</span></div>
    </div>
    <p>Phone numbers and photos stay with the people who need them.</p>`)}

  ${ch('V', 'Reading the lists', 'What the tags mean', `
    <div class="ab-legend">
      <div><i class="ab-dot over"></i><b>Overdue</b><span>The date has passed and no report has been submitted.</span></div>
      <div><i class="ab-dot due"></i><b>Coming up</b><span>Due today or later.</span></div>
      <div><i class="ab-dot vis"></i><b>Visited</b><span>Report submitted, waiting for the Regional Office's check.</span></div>
      <div><i class="ab-dot ver"></i><b>Verified</b><span>Checked and locked. Ask the admin to unverify if it needs a correction.</span></div>
      <div><i class="ab-dot over"></i><b>Sent back</b><span>The Regional Office asked for changes to your report. Open it, fix what's asked and save: it goes back for checking. Until then it counts as pending.</span></div>
      <div><i class="ab-dot hold"></i><b>On hold</b><span>You asked to reassign or remove it. It is locked and off your overdue list until the admin decides.</span></div>
    </div>
    <p>If a colleague visits a place allotted to you, it counts as visited and shows who went. In Places, every place carries its tag, so you can tell where it stands without opening it.</p>`)}

  ${ch('VI', 'Asking the admin', 'Requests', `
    <p>Too far, closed down, or a mistake in a report you can no longer change? Ask from the place or the visit: <em>reassign</em>, <em>remove</em>, <em>delete</em> or <em>unverify</em>. One request at a time; the admin approves or declines, and you see the answer.</p>`)}

  ${ch('VII', 'Where your data lives', 'On the server, with a copy on your phone', `
    <p>Visits and photos are kept in India (Mumbai), behind access rules on every record. Photos open only through links that expire in minutes.</p>
    <p>Your phone keeps its own copy, so screens open instantly and work with weak signal. It asks the server only for what changed:</p>
    <div class="ab-sync">
      <div><b>Opening</b><span>Shows the saved copy at once, then syncs.</span></div>
      <div><b>Coming back</b><span>Syncs again if you were away 2+ minutes.</span></div>
      <div><b>Pulling down</b><span>Syncs now.</span></div>
      <div><b>Your changes</b><span>Go straight into the copy. Nothing reloads.</span></div>
    </div>
    <p class="ab-note">No signal at a visit? Submit anyway. It waits on the phone and sends itself later.</p>`)}

  ${ch('VIII', 'Small things', 'Worth knowing', `
    <ul class="ab-tips">
      <li>Pull down at the top of any screen to sync, even on the sign-in screen.</li>
      <li>Swipe left or right to move between sections.</li>
      <li>Pull a panel down to close it.</li>
      <li>Back steps back, then returns to the first tab, then asks before closing.</li>
      <li>A new version shows <b>Update now</b> in Profile.</li>
      <li>Signing out removes your copy from this phone.</li>
    </ul>`)}

  <footer class="ab-foot"><img src="cbi-emblem.png" alt=""><div>TASC Connect · version ${APP_VERSION}<br>Built by Nitin Kotwar (139535), via PDUDAIRO</div></footer>
  </article>`;
}

function openAbout() {
  const body = openSheet('About', aboutHTML());
  const sh = body.closest('.sheet'); if (sh) sh.classList.add('tall');
}
document.addEventListener('click', e => { if (e.target.closest('[data-about]')) openAbout(); });
