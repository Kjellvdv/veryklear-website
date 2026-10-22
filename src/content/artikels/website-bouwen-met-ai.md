---
title: "Een website bouwen met AI: zo maakten we deze site met Claude"
description: "Kan je een website laten bouwen met AI? Ja, als je het goed voorbereidt. Hoe we deze site met Claude bouwden, in zes stappen, en wanneer WordPress of Webflow de betere keuze is."
category: AI implementeren
published_at: 2026-10-01
draft: false
image: /artikels/website-bouwen-met-ai.jpg
image_alt: "Een bureau van bovenaf met een open laptop, een rood notitieboek, een stapel papieren met een klem, een paar briefjes, een pen en een koffietas."
---

Kan je een website bouwen met AI? Ja, je leest er nu een. Deze site is met Claude gemaakt. Claude schreef de code, gewone HTML en CSS, en elk bestand daarvan kunnen we openen, lezen en aanpassen. Veel flexibeler dan met een website tool, en toch uniek genoeg?

Maar hoe beginnen we dar eigenlijk aan? En is het veilig?

## Is een site die met AI gebouwd is wel deftig?

Veel mensen denken bij een site "met AI" aan een tool waar je één zin in typt en waar een site uitkomt waarvan er dertien in een dozijn zijn. Zo werken we niet. Een site die je met Claude bouwt, is in de praktijk een site op maat: elke regel code staat er omdat iemand erom gevraagd heeft, en je kan ze allemaal nalezen.

Bij Willow, het softwarebedrijf waar ik aan de marketing werk, herwerkte ik deze zomer een Webflow website van meer dan 500 pagina's. De eerste resultaten wezen aan dat we nog even goed gevonden worden in Google als vroeger, maar nu is de website veel sneller en flexibeler.

## Hoe pak je zo'n project aan?

Zo'n project loopt meestal mis op voorbereiding en op consequent werken, veel minder op de AI zelf. Dit zijn de zes belangrijke lessen of best practices die we ontdekten om een website te maken met AI

1. **Houd je werkmap en je websitemap apart.** Onze huisstijl, onze schrijfstijl en de afspraken over wie we zijn, staan in een eigen map. De website staat in een andere. Zo blijft de site zelf proper, en dient dezelfde huisstijl ook voor alles wat we buiten de site maken.

2. **Zet alles meteen onder versiebeheer.** Met git wordt elke wijziging bewaard, met een korte zin over waarom. Loopt er iets mis, dan zet je makkelijk één stap terug zonder alles te breken.

3. **Schrijf op dag één een handleiding voor Claude.** Dat is een bestand dat CLAUDE.md heet: hoe de site in elkaar zit, welke regels vastliggen en wat nooit mag. Claude leest het bij elke opdracht, zodat je niet telkens opnieuw moet uitleggen hoe de website in elkaar zit.

4. **Leg je huisstijl vast in een ontwerpdocument, en houd je eraan.** Kleuren, letters, afstanden, hoe een kaart eruitziet. Als je daar niet op aandringt, krijgt elke nieuwe pagina haar eigen opmaak, en na een maand lijkt geen enkele pagina nog op de andere.

5. **Werk in kleine stappen.** Eén wijziging per keer, als voorstel dat je naleest voor het online komt (in git heet dat een pull request). Tien wijzigingen tegelijk aanbrengen, zorgt voor conflicten. Zo gaan er updates verloren en gaat Claude toch buiten de lijntjes kleuren qua design. 

6. **Laat routines het onderhoud doen.** Terugkerend werk draait op een vast moment. Op deze site schrijft een routine elke donderdag een eerste versie van een artikel, en die komt pas online als ik ze nagelezen heb. Bij een grotere site doen routines hetzelfde voor vertalingen of voor pagina's die op elkaar moeten blijven lijken. De machine kijkt na, stelt veranderingen voor, en ik of iemand anders keuren ze goed.

Elke goedgekeurde wijziging gaat daarna vanzelf online, via Railway of Netlify, bijvoorbeeld.

## Wanneer kies je beter WordPress of Webflow?

De keuze hangt af van wie de site daarna onderhoudt. Wij werken elke dag met Claude, dus voor ons is een tekstbestand aanpassen sneller dan inloggen in een admin paneel. 

Wil je zelf of een medewerker teksten en foto's veranderen in een scherm dat je kent, dan zijn WordPress en Webflow een heel verstandige keuze. Ze bestaan al jaren, veel mensen kunnen ermee werken, en je hangt van niemand af om teksten aan te passen. Ook security updates gebeuren quasi vanzelf. 

Een site bouwen met AI loont vooral als je veel controle wil, als snelheid telt, of als je andere tools makkelijk wil integreren. Maar je bent wel volledig zelf verantwoordelijk voor alles.

Welke weg je ook kiest, de vraag blijft dezelfde: wie werkt er over een jaar nog aan je site, en begrijpt die persoon wat er staat?
