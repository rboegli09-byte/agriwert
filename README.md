# AgriWert 🚜 – Landmaschinen bewerten (Etappe 1)

Web-App zur Bewertung und Preisermittlung von gebrauchten Landmaschinen.
Läuft im Browser auf **Handy, Tablet und Computer** (Android & iOS über den Browser).

**Was Etappe 1 kann:**
- Login **nur auf Einladung** – der Admin lädt direkt in der App per E-Mail ein,
  die Person wählt ihr Passwort selbst; Passwort jederzeit selbst änderbar
- Maschinen erfassen: Grunddaten, Ausstattung, Zustand, Notizen
- **Fotos** hochladen (werden automatisch verkleinert)
- **Preis automatisch berechnen** (Neupreis − Alter − Betriebsstunden ± Zustand + Ausstattung)
- **Alle Benutzer sehen alles – in Echtzeit** (lädt einer hoch, sehen es die anderen)
- **Admin-Einstellungen**: alle Preis-Faktoren selbst anpassen
- Rollen vergeben (Admin, Verkäufer, Werkstatt …)
- Hell-/Dunkelmodus automatisch

---

## Einrichtung – Schritt für Schritt

Du machst das **einmal**. Danach läuft alles. Plane ca. 20–30 Minuten ein.

### Schritt 1 – Supabase-Konto & Projekt anlegen
1. Gehe auf **https://supabase.com** → *Start your project* → mit E-Mail registrieren.
2. Klicke **New project**.
   - *Name:* `agriwert`
   - *Database Password:* ein starkes Passwort (irgendwo sicher notieren)
   - *Region:* `Central EU (Frankfurt)` (nah an der Schweiz)
3. Warte ~2 Minuten, bis das Projekt bereit ist.

### Schritt 2 – Datenbank aufbauen
1. Im Supabase-Dashboard links auf **SQL Editor** → **New query**.
2. Öffne die Datei [`supabase-schema.sql`](supabase-schema.sql), kopiere den **ganzen** Inhalt hinein.
3. Klicke **RUN** (unten rechts). Es sollte „Success" erscheinen.

### Schritt 3 – Zugangsdaten in die App eintragen
1. Im Dashboard: **Project Settings** (Zahnrad unten links) → **API**.
2. Kopiere:
   - **Project URL**
   - **anon public** (langer Schlüssel)
3. Öffne die Datei [`js/config.js`](js/config.js) und trage beide Werte ein:
   ```js
   export const SUPABASE_URL = 'https://xxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGci...';
   ```
   > Der `anon`-Schlüssel darf öffentlich sein. **Nie** den `service_role`-Schlüssel verwenden.

### Schritt 4 – Foto-Speicher (Storage) anlegen
1. Im Dashboard links auf **Storage** → **New bucket**.
   - *Name:* `machine-photos` (genau so schreiben!)
   - *Public bucket:* **einschalten** (Häkchen), damit die Fotos angezeigt werden.
   - **Create bucket**.
2. Zurück in den **SQL Editor** → **New query**.
3. Öffne [`supabase-storage.sql`](supabase-storage.sql), kopiere alles hinein → **RUN**.

### Schritt 5 – Einladungssystem einrichten
1. **SQL Editor** → **New query** → Inhalt von [`supabase-einladungen.sql`](supabase-einladungen.sql)
   einfügen → **RUN**.
2. Danach: **Authentication** → **Sign In / Providers** → **Email**:
   - **„Allow new users to sign up"** → **EIN**
   - **„Confirm email"** → **AUS**
   - Speichern.

> **Warum ist das sicher, obwohl die Registrierung „offen" ist?**
> Der Schutz sitzt nicht mehr im Schalter, sondern in der **Datenbank**: Ein Trigger
> prüft bei jeder Registrierung, ob die E-Mail-Adresse in der Tabelle `einladungen`
> steht. Ist sie es nicht, wird das Konto abgelehnt. Das lässt sich vom Browser aus
> nicht umgehen – im Gegensatz zu einer Prüfung im JavaScript.

### Schritt 6 – Admin-Konto anlegen
Der **allererste** Benutzer wird automatisch **Admin** und braucht keine Einladung.
1. Dashboard → **Authentication** → **Users** → **Add user** → **Create new user**.
   - E-Mail = **deine Admin-E-Mail**, ein Passwort setzen, *Auto Confirm User* anhaken.
2. Alle **weiteren** Personen lädst du danach **direkt in der App** ein
   (Reiter **Benutzer** → E-Mail + Rolle → *Einladen*). Die Person geht auf den Link,
   klickt **„Konto erstellen"** und wählt ihr Passwort selbst.
3. Jeder kann sein Passwort später unter **Konto** selbst ändern.

### Schritt 7 – App testen
- **Lokal:** die Datei `index.html` mit einem kleinen Webserver öffnen (nicht per Doppelklick,
  wegen der Module). Einfachster Weg mit Node.js:
  ```powershell
  npx serve .
  ```
  (In **PowerShell** im Ordner `AgriWert` ausführen; öffnet einen lokalen Link, z. B. `http://localhost:3000`.)

### Schritt 8 – Veröffentlichen auf GitHub Pages
Damit du den Leuten einen **Link** schicken kannst:
1. Neues GitHub-Repository anlegen, z. B. `agriwert`, und den Inhalt dieses Ordners hochladen.
2. Im Repo: **Settings → Pages → Source: „Deploy from a branch" → Branch: `main` / `/root`** → Save.
3. Nach 1–2 Minuten ist die App unter `https://deinname.github.io/agriwert/` erreichbar.
4. Diesen Link schickst du deinen 3 Leuten. Auf dem Handy: „Zum Startbildschirm hinzufügen" =
   fühlt sich an wie eine echte App.

---

## Preisformel (anpassbar unter *Einstellungen*)

```
Preis = Neupreis
        × (1 − Wertverlust%/Jahr) ^ Alter
        × (1 − Betriebsstunden/100 × Wertverlust%/100h)
        × (1 ± (Zustandsnote − neutrale Note) × Zu-/Abschlag%)
        + Summe der Ausstattungs-Zuschläge
        (nie unter Mindestrestwert % vom Neupreis)
```

Alle Faktoren ändert der Admin live in der App unter **Einstellungen**.

---

## Projektstruktur

```
AgriWert/
├── index.html              Einstiegsseite
├── css/style.css           Design (hell/dunkel, mobil)
├── js/
│   ├── config.js           ← hier Supabase-Daten eintragen
│   ├── supabase.js         Verbindung zur Cloud
│   ├── pricing.js          Preis-Berechnung (reine, testbare Funktionen)
│   ├── photos.js           Fotos verkleinern & hochladen
│   └── app.js              Hauptlogik (Login, Liste, Formular, Einstellungen)
├── supabase-schema.sql     Datenbank-Aufbau (Schritt 2)
├── supabase-storage.sql    Foto-Speicher-Regeln (Schritt 4)
├── supabase-einladungen.sql Einladungssystem (Schritt 5)
└── README.md               diese Anleitung
```

---

## Nächste Etappen (später)
2. Baugruppen-Bewertung (Motor, Getriebe … 1–10), Reifen, Schäden, Zustandsindex
3. Dashboard, erweiterte Suche, PDF-Export
4. Offline-Modus, Kommentare, Versionshistorie, Audit-Log
5. KI-Bilderkennung & Marktvergleich (nur mit legaler Datenquelle)
