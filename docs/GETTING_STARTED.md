# Builders — Getting Started Guide

**Your first hour with Builders.**

This guide is for people who have never used Builders before. You do not need to be technical.
If you can describe your business in plain words, you can use Builders.

> [!NOTE]
> This is the **simple** guide. If you later want the full detail — every screen, every setting,
> every troubleshooting step — read the [User Guide](USER_GUIDE.md). You do not need it to start.

---

## Welcome

### What Builders does

Builders turns a business idea into working software.

You describe what your business needs. Builders writes the requirements, plans the product, and
then builds the application for you.

Think of it like hiring a software team. You are the customer. You explain what you want, you
check the work, and you approve it. Builders does the building.

### What you will accomplish

By the end of this guide you will have:

1. Created your first project
2. Explained your business to Builders
3. Reviewed and approved a requirements document
4. Generated a working application
5. Opened it and tried it out

### What you do **not** need to worry about

You do **not** need to know:

- Any programming language
- How databases work
- What "architecture" or "deployment" mean
- Anything about AI models or settings

Builders handles all of that. Your job is to explain your business clearly and to check the work.

> [!TIP]
> **The single most useful thing you can do is describe your business in detail.** Everything else
> in this guide is easy. That one thing decides how good your software will be.

---

## 1. Login

1. Open the Builders link you were given.
2. Type your **email**.
3. Type your **password**.
4. Click **Sign In**.

That's it. You will land on the Builders home screen.

> [!NOTE]
> Builders is invitation only right now. There is no "Sign up" button. If you don't have a
> login, ask the person who sent you the link.

You normally only sign in once. Builders remembers you on that computer.

---

## 2. Create Your First Project

On the home screen, click **Start a New Project** (or **New Project** in the left sidebar).

A small form appears. Here is what each field means.

### Project Name

The name of the thing you are building.

| | Example |
|---|---|
| ✅ **Good** | `Tailoring Shop Management` |
| ✅ **Good** | `Sunrise Dental Clinic Booking` |
| ❌ **Bad** | `Test` |
| ❌ **Bad** | `Project 1` |
| ❌ **Bad** | `asdf` |

Use the real name of the business or the product. You will have many projects later, and
`Test` is impossible to find again.

### Description

One or two lines about what this project is for.

**Example:**

> We need a web application for a tailoring shop to manage customer measurements, orders,
> delivery dates and billing.

This is not the full requirements — you will give those in the next step. This is just a quick
summary so Builders knows what kind of product it is.

### Generation Profile

This decides how much effort Builders puts into building your software.

| Option | What it means | When to pick it |
|---|---|---|
| **Fast Prototype** | Quickest and cheapest. Lower quality. | You are just trying Builders out, or testing an idea you will throw away. |
| **Balanced** ⭐ | A good mix of speed and quality. | **Pick this.** It is the right choice for almost everyone. |
| **Production** | Best quality. Slower and more expensive. | Your final build, when you want the best possible result. |

> [!TIP]
> If you are unsure, choose **Balanced**. You can create another project on a different profile
> later if you want to compare.

### Blueprint

A Blueprint tells Builders what *kind* of business you are in, before you explain anything.

If you pick **Business Website**, Builders already knows that businesses like yours usually need
a homepage, a contact form, a services page, and so on. That makes its first draft much better.

- Pick the option closest to what you are building.
- If nothing fits, pick **Blank Project**. Nothing is lost — you will explain everything
  yourself in the next step.
- Some options say *Coming soon*. Those cannot be picked yet.

> [!NOTE]
> A Blueprint is only a helpful starting point. It never overrules what you ask for. If the
> Blueprint suggests something you don't want, what you asked for always wins.

### Icon and Colour

Purely decoration, so you can spot the project in your list. Pick anything.

Now click **Create Project**. It appears in your sidebar straight away.

---

## 3. Business Discovery

> [!IMPORTANT]
> **This is the most important step in Builders.** Please do not rush it.
>
> The better you explain your business, the better Builders builds your software. This is the
> one step where the time you spend really pays off.

Open your project and go to the **Business** tab.

Builders now wants to understand your business. There is no wrong way to do this — just be as
clear and complete as you can.

### Why this matters so much

Builders will not guess about your business. If you don't tell it something, it either asks you,
or it writes down an assumption. Assumptions can be wrong.

So: **whatever you leave out, you may not get.**

### Poor vs good requirements

Here is the same project explained two ways.

**❌ Poor — too vague**

> I need tailoring software.

Builders can only produce something generic from this. It doesn't know who uses it, what they
do, or what matters to your shop.

**✅ Good — clear and complete**

> I need a web application for a tailoring shop where staff can search customers using mobile
> number, store measurements, track orders, delivery dates, alterations, payments and customer
> history.

Now Builders knows the users (staff), the actions (search, store, track), and the real things
your business cares about (measurements, alterations, payments).

### Another example

**❌ Poor**

> A booking system for a clinic.

**✅ Good**

> A booking system for a two-dentist clinic. Receptionists book appointments and see the day's
> schedule. Patients cannot book themselves yet. We need patient contact details, treatment
> history, appointment reminders by SMS, and a daily report of who is coming in tomorrow.

### Things worth mentioning

Try to cover these. You don't need all of them, but each one you answer improves the result:

- **Who uses it?** Staff, managers, customers, admins — list them.
- **What does each person do?** "The receptionist books appointments. The owner sees reports."
- **What information do you store?** Names, measurements, orders, payments.
- **What are your rules?** "An order cannot be delivered before it is paid."
- **What reports do you need?** "A monthly sales summary."
- **What must it connect to?** WhatsApp, SMS, payment provider, existing system.
- **What is NOT needed?** This is just as valuable — see the tip below.

> [!TIP]
> **Say what you do NOT want.** For example: "We do not need online payments yet" or "Customers
> do not log in." This stops Builders from building things you never asked for, and keeps your
> first version small and useful.

### Knowing when you are done

As you add information, Builders shows how ready it is:

| What you see | What it means | What to do |
|---|---|---|
| 🔴 **Insufficient Information** | Not enough to work with yet. | Keep going. Focus on who uses it and what it must do. |
| 🟡 **Needs More Information** | Nearly there. Builders will tell you what's missing. | Fill in the areas it lists. |
| 🟢 **Ready** | Good to go. | Move to the next step. |

> [!WARNING]
> Builders will let you continue while it still says amber. But the requirements will contain
> more guesses, and those guesses carry through to the finished software. **Wait for green.**
> It is worth the extra ten minutes.

---

## 4. Answer the AI Questions

Builders may ask you follow-up questions. This is a normal conversation — it is checking things
it isn't sure about.

**How to answer well:**

- **Use full sentences.** "Salon owners in small towns who take bookings on WhatsApp today" is
  worth far more than "salons".
- **Don't rush.** A one-word answer gives you a one-word-quality result.
- **Say "I don't know" when you don't know.** Builders will record it as an open question and
  come back to it. That is much safer than you guessing.
- **Add anything it didn't ask about.** If something matters to your business, say it, even if
  there was no question about it.

> [!TIP]
> More detail here = better software later. This is the cheapest place in the whole process to
> get things right.

---

## 5. Review the Requirements

Once Builders understands enough, it writes your **Requirement Document**.

This is a written description of the software it is about to build. Read it properly. This is
your chance to catch mistakes while they are still cheap to fix.

**What to look for, in this order:**

1. **Assumptions** — things Builders decided because you didn't say. Check every one.
2. **Open questions** — things it could not work out. Answer them.
3. **Out of scope** — make sure nothing you actually need is sitting in this list.
4. **Your business rules** — make sure they are right. A wrong rule creates software that works
   perfectly and does the wrong thing.

**If something is wrong:**

- If a **business fact** is wrong, go back to the Business tab, fix your answers, and let
  Builders write the document again.
- If it is just **wording**, edit the document directly.

When you are happy, click **Approve**.

> [!NOTE]
> Approving is not permanent. You can come back, change things, and regenerate at any time.
> Approve when it is *right enough to build on*, not when it is perfect.

---

## 6. Review the Product

At the top of your project you will see five steps. This is your map. Here is what each one
means, in plain language.

### Business

This is where you explain your business and approve the requirements — the step you just
finished. Everything else is built on it.

### Blueprint

This confirms what kind of product you are building. You chose it when you created the project.
You can look at it here and see what Builders thinks is the best match. Most people just check
it and move on.

### MVP

MVP means "the first useful version". Builders proposes a list of features for your first
release, and holds back the rest for later.

**This step needs your approval, and it matters.** Check that everything essential is in the
first version, and that nothing you never asked for has appeared. This is where you control how
big the first build is.

### Engineering

Builders now does the technical work by itself — designing the screens, the data, and the logic.
You don't need to do anything here. You can watch it happen if you're curious. It takes a few
minutes.

### Application

The finished software. This is where you generate it, look at it, and share it.

---

## 7. Generate the Application

Go to the **Application** tab and click **Generate**.

Builders now writes your actual software.

**What to expect:**

- It takes **several minutes**. A small project is quicker; a big one on the *Production* profile
  takes longer.
- You will see progress on screen as it works through the different parts.
- A preview usually appears **before it has completely finished**, so you can start looking early.
- You can stop it at any time. Nothing already built is lost.

> [!TIP]
> Go and make a cup of tea. You do not need to watch the screen. Builders keeps working.

---

## 8. Review the Generated App

Open the **Preview** and actually use the application.

Work through this list:

- **Does it open and run?**
- **Can you do the main job?** For the tailoring example: add a customer, save measurements,
  create an order, mark it delivered.
- **Are your features there?** Compare against the requirements you approved.
- **Are your business rules respected?** Try to break one on purpose and see what happens.
- **Does the information look right?** The right fields, the right names, the right screens.

Write down anything that looks wrong. You'll fix it in the next step.

---

## 9. If Something Is Wrong

**Don't panic.** This is completely normal, and it is easy to fix.

Nothing is broken and nothing is lost. Builders keeps every version of everything.

**What to do:**

1. Work out *where* the problem started. Is the software wrong, or were the **requirements**
   wrong?
2. Most of the time, the requirements were unclear. Go back to the **Business** tab and explain
   that part better.
3. Let Builders write the requirements again, and review them.
4. Generate again.

> [!IMPORTANT]
> **Builders improves as your requirements improve.** If the result isn't right, the fastest fix
> is almost always to explain your business more clearly — not to keep regenerating the same
> instructions and hoping for a different answer.

Regenerating is safe. Builders reuses the work that was already correct, so it is quicker the
second time.

---

## 10. Best Practices

A short checklist. Follow these and your results will be far better.

- ✓ **Give detailed requirements.** Detail is the single biggest factor in quality.
- ✓ **Mention what should NOT be built.** It keeps your first version small and focused.
- ✓ **Mention user roles.** Who is staff? Who is a manager? Who is a customer?
- ✓ **Mention business rules.** "Orders cannot be edited after delivery."
- ✓ **Mention reports required.** "A monthly income report by staff member."
- ✓ **Mention integrations.** WhatsApp, SMS, email, payments, an existing system.
- ✓ **Mention future ideas separately.** Say "later, we would like…" so Builders doesn't build it
  now.
- ✓ **Read every document before approving.** Ten minutes here saves hours later.
- ✓ **Use real project names.** Not `Test`.
- ✓ **Wait for the green "Ready" state** before generating requirements.

---

## 11. Example Projects

Here are realistic examples to give you a feel for the level of detail that works well.

### Tailoring Shop Management

> Staff search customers by mobile number, store body measurements, create orders with delivery
> dates, record alterations, take part payments, and see a customer's full history. The owner
> needs a daily list of orders due.

Good because it names the users, the daily actions, and the one report that matters.

### Dental Clinic

> Receptionists book appointments for two dentists, store patient contact details and treatment
> history, and send SMS reminders. Patients cannot book themselves. The owner sees tomorrow's
> schedule each evening.

Good because it says clearly what is **not** included (patient self-booking).

### Event Registration

> Visitors register for an event online with name, email and ticket type. Organisers see the
> attendee list, mark people as arrived on the day, and export the list to a spreadsheet.

Good because it covers both sides — the public visitor and the internal organiser.

### Restaurant Ordering

> Customers browse the menu and place a takeaway order. Kitchen staff see incoming orders on a
> screen and mark them ready. The manager sets menu items and prices, and sees daily sales.

Good because it describes three different roles and what each one does.

### Inventory Management

> Staff record stock coming in and going out, see current quantities, and get a warning when an
> item falls below its minimum level. The manager sees a monthly stock movement report.

Good because it includes a clear business rule (the low-stock warning).

> [!TIP]
> Notice the pattern in all five: **who uses it → what they do → what is stored → what report is
> needed → what is not included.** Copy that pattern for your own project.

---

## 12. Frequently Asked Questions

**How long does it take?**
Explaining your business properly takes the longest — usually 20 to 40 minutes, and it is worth
it. Generating the application takes a few minutes after that.

**Can I edit the requirements?**
Yes. You can edit the document directly, or go back and change your answers and let Builders
rewrite it. If a business fact is wrong, changing your answers is the better fix.

**Can I regenerate?**
Yes, as often as you like. Older versions are always kept, so you can never lose work by trying
again.

**Can I delete projects?**
Yes. Hover over the project in the left sidebar and use the delete button. You will be asked to
confirm. Deleting cannot be undone, so be sure.

**Do I need to approve everything?**
No. Only two things need you: the **requirements** and the **MVP feature list**. Builders handles
the rest by itself.

**What if generation fails or stops?**
Nothing is lost. Start it again — Builders picks up where it left off and reuses what was already
finished.

**Can two people work on the same project at once?**
Not yet. Each person has their own login and their own projects. For now, one person should drive
a given project at a time.

**Do I need to know anything technical?**
No. If you can explain your business clearly, that is enough.

**Is the software ready to give to real customers?**
Treat it as a strong first version, not a finished product. Builders is in Early Access. Always
review what it produces before putting it in front of real customers.

**Where do I go for more detail?**
The [User Guide](USER_GUIDE.md) is the full reference manual. It covers every screen, setting and
troubleshooting step.

---

## You're Ready

That's everything you need to start.

To recap the whole thing in one line:

> **Describe your business clearly → check what Builders writes → approve it → generate → try it out.**

If you get stuck, go back a step and add more detail. That fixes most problems.

Good luck, and welcome to Builders.
