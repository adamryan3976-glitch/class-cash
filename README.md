# Class Cash

A paperless classroom economy for K–8 classes. Teachers manage their class bank from a laptop or phone; each student gets a private link that shows only their own balance.

- **Teachers** sign in with their @ddsb.ca Google account at one shared web address. There's nothing for them to install or set up.
- **Classes can be shared.** The class owner adds other teachers (e.g. rotary teachers) by school email. They see the class the next time they sign in.
- **Students** never sign in. Each student gets a link with a random 22-character code (e.g. `student.html?k=FHpl_qhIx4oYYxPFqkNJ2Q`). It can't be guessed, and it only loads that one student's balance and history.
- Student emails, the class list and the full transaction log can only be read by teachers of that class.

## Files

| File | What it is |
|---|---|
| `index.html`, `js/teacher.js` | Teacher app: Bank, Students, History, Settings, Import |
| `student.html`, `js/student.js` | Student balance page |
| `js/sheet-import.js` | Import from the old Google Form/Sheet |
| `js/util.js` | Shared helpers |
| `js/firebase-config.js` | **Your Firebase settings go here** |
| `firestore.rules` | Database security rules (**must be published**, see step 4) |
| `css/style.css` | Styles |

## One-time setup (about 15 minutes, done once by one person)

Only the person hosting Class Cash does this. Every other teacher just opens the link and signs in.

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** → name it (e.g. `class-cash`). Google Analytics can be off.
2. **Build → Firestore Database → Create database** → choose **Production mode** → location `northamerica-northeast2 (Toronto)` keeps data in Canada.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable** → Save.

### 2. Register the web app
1. **Project settings** (gear) → **General** → *Your apps* → **Web (`</>`)** → name it → Register (no hosting needed).
2. Copy the `firebaseConfig` values into `js/firebase-config.js`.

### 3. Allow your GitHub Pages address to sign in
**Authentication → Settings → Authorized domains → Add domain** → `YOUR-GITHUB-USERNAME.github.io`, plus your custom domain if you use one (e.g. `class-cash.winchesterps.ca`).

### 4. Publish the security rules
**Firestore Database → Rules** → replace everything with the contents of `firestore.rules` → **Publish**.

> Only **@ddsb.ca** Google accounts can sign in as teachers. This is enforced by `signedIn()` in the rules, and the app shows a friendly message to anyone using another account. To use a different domain, change it in both `firestore.rules` and `ALLOWED_DOMAIN` in `js/firebase-config.js`.

### 5. Check the rules (2 minutes, recommended)
In **Firestore Database → Rules → Rules Playground**, try these. Turn on *Authenticated* and give the signed-in user an @ddsb.ca email unless a check says otherwise:
- `get` on `/shares/anything-at-least-20-chars` with *Authenticated* **off** → should be **allowed** (that's a student opening a link)
- `list` on `/shares` (use path `/shares` with *Query* type) → **denied**
- `get` on `/classes/someClassId` where you're not a teacher → **denied**
- `create` on `/classes/test` as an authenticated user with email `someone@gmail.com` → **denied** (only @ddsb.ca teachers)

### 6. Publish on GitHub Pages
1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root** → Save.
3. After a minute the app is live at `https://YOUR-GITHUB-USERNAME.github.io/REPO-NAME/`.

## Using it

**Classes**: the first time a teacher signs in, they tap **Create a class**. The menu at the top switches between classes and has **+ New class…**. Rotary teachers see every class they've been added to here, marked *(co-teacher)*.

**Sharing a class with other teachers** (Settings → *Teachers*): the owner types a teacher's school email and taps **Add teacher**, then **Copy invite** to copy a short message with the link that you can paste into a message to them. The class appears in their class menu the next time they sign in. What each teacher can do:

| | Owner | Co-teacher |
|---|:-:|:-:|
| Deposit, withdraw, undo | ✓ | ✓ |
| Add/edit students, copy/reset links, import | ✓ | ✓ |
| Change class settings | ✓ | |
| Add or remove teachers | ✓ | |
| Delete students or the whole class | ✓ | |
| Leave the class | | ✓ |

The History tab shows which teacher made each transaction.

**Students tab**: type one student per line: the name you want them to see, then their student email (optional, only teachers see it). You can also paste two columns from a spreadsheet. Examples:
```
Jordan L.   S123456789@ddsbstudent.ca
Sam P.	S987654321@ddsbstudent.ca      ← tab between (pasted from a spreadsheet)
MS
```
Students never type a username or password; their private link is all they need. The email just helps teachers keep track of who's who.
For each student you can **Copy link** (paste it wherever your students get messages, e.g. Google Classroom or a bookmark on a class device) or **Preview**. Under **More** you can edit, **Reset link** (the old link stops working immediately) or, if you're the owner, delete the student. **Copy all links** copies a Name / Email / Link table you can paste into a private spreadsheet.

**Bank tab**: tap students to select them (or **Select all** for the whole class), pick or type an amount, add an optional reason, then **Deposit** or **Withdraw**. Withdrawals are blocked if a student doesn't have enough, unless you allow negative balances in Settings.

**History tab**: every transaction, filterable by student. **Undo** removes a transaction and fixes the balance (on the student's page too).

**Settings tab**: class name, currency name (e.g. *Maple Bucks*, *Pesos*), symbol, quick-amount buttons, negative balances. The owner can also add a **currency logo**: any picture (PNG, JPG, GIF, WebP, SVG). It's shrunk automatically to a small image and shown on each student's balance page and next to balances on the Bank tab. At the end of the year the owner can **Delete class**.

### Moving over from the old Google Sheet
1. Add your whole class on the Students tab first (whole-class deposits are given to everyone in the list).
2. In the old sheet: **Form Responses 1** tab → **File → Download → Comma-separated values (.csv)**.
3. Settings → *Import from the old Google Sheet* → choose the file. Each name from the sheet is matched to a Class Cash student where possible (e.g. "Lee, Jordan" → "Jordan L."). Check every match, then **Import transactions**.
4. Spot-check a few balances against the old **Class Bank Balance** tab. Only import once, or amounts will be doubled.

## Privacy notes

- Student pages have `noindex` and `no-referrer`, so links aren't picked up by search engines or leaked to other sites.
- If a student shares their link, **Reset link** and send a new one.
- Student emails are optional and only visible to teachers of the class. Leave them blank if you'd rather not store them.
- Class logos are not private: anyone with a student link can see that class's logo. Don't use photos of students.
- Deleting a student removes their balance, history and link.

## How the data is stored (for maintainers)

```
classes/{classId}                       settings, ownerUid, ownerEmail, memberEmails[] (teachers of the class)
classes/{classId}/students/{id}         displayName, email (optional), token, balance (cents)
classes/{classId}/transactions/{id}     studentId, amount (cents), note, t, group, by (teacher email), pub
shares/{token}                          classId, displayName, balance, history[], currency/class name
logos/{classId}                         image (small data: URL, < 150 KB), updatedAt — readable by anyone, owner writes
```
Teachers are matched by the email on their Google account (lower-cased), so add the exact address they sign in with.
`shares/{token}` (plus their class logo) is the only thing a student can read, and only with the exact token. Amounts are stored as whole cents to avoid rounding errors.
