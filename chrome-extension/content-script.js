(async () => {
	// Talks to the same backend API the ov-chipkaart.nl site uses, instead of scraping the travel history grid.
	// The grid re-selects all rows whenever its data changes, and pages at 100 rows, so scraping it is unreliable.
	const API = "/backend/moc"

	const state = {
		card: null, // {mediumId, alias, expiryDate}
		month: null, // [startDdMmYyyy, endDdMmYyyy, label]
		transactions: [],
		selectedIds: new Set(),
	}

	setInterval(async () => {
		if (document.getElementById("extension-div")) {
			return
		}
		if (!(document.location.href.includes("mijn-ov-reishistorie") || document.location.href.includes("my-travel-history"))) {
			return
		}
		const mountPoint = findCardSelectionBox()
		if (mountPoint) {
			await renderExtensionDiv(mountPoint)
		}
	}, 100)

	// The "Selecteer kaart" box: the first list on the page is the card list, its box is the first ancestor with a heading.
	// Class names on the site are hashed, so don't rely on them.
	function findCardSelectionBox() {
		let element = document.querySelector("main ol")
		while (element && element.tagName !== "MAIN" && !element.querySelector("h2")) {
			element = element.parentElement
		}
		return element?.tagName === "MAIN" ? null : element
	}

	async function api(path, body) {
		const session = await (await fetch("/api/auth/session")).json()
		const response = await fetch(API + path, {
			method: body ? "POST" : "GET",
			headers: {
				"Accept": "application/json",
				"Content-Type": "application/json",
				"Authorization": `Bearer ${session.id_token}`,
				"Accept-Language": document.documentElement.lang || "nl",
			},
			body: body ? JSON.stringify(body) : undefined,
		})
		if (!response.ok) {
			throw new Error(`${path} failed with HTTP ${response.status}`)
		}
		return response.json()
	}

	async function getCards() {
		const { cards } = await api("/cards/retrieve")
		return cards
	}

	async function getCardDetails(card) {
		const details = await api(`/cards/retrievedetails?hashedMediumId=${encodeURIComponent(card.hashedMediumId)}`)
		return { mediumId: card.mediumId, alias: card.alias, expiryDate: details.cardStatus.expiryDate }
	}

	function ddMmYyyyToIso(ddMmYyyy) {
		const [dd, mm, yyyy] = ddMmYyyy.split("-")
		return `${yyyy}-${mm}-${dd}`
	}

	function requestBase() {
		return {
			mediumId: state.card.mediumId,
			expiryDate: state.card.expiryDate,
			dateFilter: { start: ddMmYyyyToIso(state.month[0]), end: ddMmYyyyToIso(state.month[1]) },
			transactionKindFilter: null,
		}
	}

	async function getTransactions() {
		const result = await api("/cardtravelhistory/cardtransactions", requestBase())
		if (result.totalItems > result.cardTransactionSummaries.length) {
			console.warn(`OV Chipkaart Rapid Declarations: only got ${result.cardTransactionSummaries.length} of ${result.totalItems} transactions`)
		}
		return result.cardTransactionSummaries
	}

	async function downloadDocument(documentFormat, extension) {
		const result = await api("/cardtravelhistory/generatedocument", {
			...requestBase(),
			documentFormat,
			selectedTransactions: state.transactions.map((t) => ({ id: t.transactionId, isSelected: state.selectedIds.has(t.transactionId) })),
		})
		const a = document.createElement("a")
		a.href = `data:${result.document.mimeType};base64,${result.document.content}`
		a.download = `ov-chipkaart-nl-${state.card.alias}-${state.month[2]}.${extension}`.replace(/\s+/g, "-")
		document.body.append(a)
		a.click()
		a.remove()
	}

	function isWeekDay(isoDateTime) {
		const date = new Date(isoDateTime)
		const day = date.getDay()
		// Saturday night trips before 7:00 count as part of Friday
		return (day !== 0 && day !== 6) || (day === 6 && date.getHours() < 7)
	}

	function formatDate(isoDateTime) {
		return new Date(isoDateTime).toLocaleDateString("nl-NL", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
	}

	// A check-out record already contains its check-in station (checkInInfo) and the fare, so it represents a whole trip.
	// Its check-in record is the closest earlier check-in with the same operator.
	function getAllTrips() {
		const chronological = [...state.transactions].sort((a, b) => a.transactionDateTime.localeCompare(b.transactionDateTime))
		const trips = []
		const unmatchedEvents = []
		let outstandingCheckIn = null
		for (const t of chronological) {
			if (t.transactionKind !== "TRAVEL") {
				continue
			}
			const isCheckOut = t.checkInInfo !== null
			if (!isCheckOut) {
				if (outstandingCheckIn) {
					unmatchedEvents.push(outstandingCheckIn)
				}
				outstandingCheckIn = t
				continue
			}
			const checkIn = outstandingCheckIn?.publicTransportOperator === t.publicTransportOperator ? outstandingCheckIn : null
			if (outstandingCheckIn && !checkIn) {
				unmatchedEvents.push(outstandingCheckIn)
			}
			outstandingCheckIn = null
			if (!t.fare) {
				continue // free trip
			}
			trips.push({
				id: t.transactionId,
				company: `${t.modalityType} ${t.publicTransportOperator}`,
				from: t.checkInInfo,
				to: t.transactionInfo,
				dateTime: checkIn?.transactionDateTime ?? t.transactionDateTime,
				isWeekDay: isWeekDay(checkIn?.transactionDateTime ?? t.transactionDateTime),
				fare: t.fare,
			})
		}
		if (outstandingCheckIn) {
			unmatchedEvents.push(outstandingCheckIn)
		}
		return { trips, unmatchedEvents }
	}

	async function renderExtensionDiv(mountPoint) {
		if (document.getElementById("extension-div")) {
			// div already exists
			return
		}

		const div = document.createElement("div")
		div.id = "extension-div"
		div.classList.add("extension-div")
		mountPoint.appendChild(div)

		const h3 = createH3("OV Chipkaart Rapid Declarations")
		h3.prepend(createImage("android-chrome-192x192.png"))
		div.appendChild(h3)
		div.appendChild(createP("This is a chrome extension to quickly file expense reports. The original website is a pain in the ass to use, so this extension aims to fix that."))
		div.appendChild(document.createElement("hr"))

		const cardContainer = document.createElement("div")
		div.appendChild(cardContainer)
		const buttonContainer = document.createElement("div")
		div.appendChild(buttonContainer)
		const selectorContainer = document.createElement("div")
		selectorContainer.classList.add("extension-selector-container")
		div.appendChild(selectorContainer)

		const cards = await getCards()
		const cardSelect = document.createElement("select")
		for (const card of cards) {
			const option = document.createElement("option")
			option.value = card.mediumId
			option.textContent = `${card.alias} (${card.mediumId})`
			cardSelect.appendChild(option)
		}
		try {
			const lastCard = localStorage.getItem("ov-rapid-declarations-card")
			if (cards.some((card) => card.mediumId === lastCard)) {
				cardSelect.value = lastCard
			}
		} catch (e) {}
		cardSelect.addEventListener("change", async () => {
			try {
				localStorage.setItem("ov-rapid-declarations-card", cardSelect.value)
			} catch (e) {}
			await selectCard()
		})
		cardContainer.append("Card: ", cardSelect)

		async function selectCard() {
			state.card = await getCardDetails(cards.find((card) => card.mediumId === cardSelect.value))
			await loadMonth()
		}

		// Generate a list of the first and last day of the month for the previous 18 months
		const generateLast18Months = () => {
			const dates = [];
			const today = new Date();
			for (let i = 0; i < 18; i++) {
				const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
				const formattedDate = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
				const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
				const formattedLastDay = `${String(lastDay.getDate()).padStart(2, '0')}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${lastDay.getFullYear()}`;
				const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });
				dates.push([formattedDate, formattedLastDay, monthYear]); // Format as DD-MM-YYYY, DD-MM-YYYY, Month Year
			}
			return dates;
		};

		const dates = generateLast18Months();
		state.month = dates[0]

		// Create buttons for each date
		dates.forEach((date, i) => {
			const button = document.createElement("button");
			button.textContent = date[2];
			if (i === 0) {
				button.classList.add("selected")
			}
			button.addEventListener("click", async (event) => {
				for (const button of buttonContainer.children) {
					button.classList.remove("selected")
				}
				event.target.classList.add("selected")
				state.month = date
				await loadMonth()
			});
			buttonContainer.appendChild(button);
		});

		await selectCard()
	}

	async function loadMonth() {
		const container = document.querySelector(".extension-selector-container")
		container.innerHTML = ""
		container.appendChild(createP("Loading..."))
		state.selectedIds = new Set()
		try {
			state.transactions = await getTransactions()
		} catch (e) {
			container.innerHTML = ""
			container.appendChild(createP(`Could not load transactions: ${e.message}`))
			return
		}
		renderTrips()
	}

	function createH3(text) {
		const h3 = document.createElement("h3")
		h3.textContent = text
		return h3
	}
	function createP(text) {
		const p = document.createElement("p")
		p.textContent = text
		return p
	}
	function createImage(src) {
		const img = document.createElement("img")
		img.width = 96
		img.height = 96
		img.src = chrome.runtime.getURL(src)
		return img
	}

	function renderTrips() {
		const { trips, unmatchedEvents } = getAllTrips()

		const container = document.querySelector(".extension-selector-container")
		container.innerHTML = ""

		const summary = createP("")
		function updateSummary() {
			const selectedTrips = trips.filter((trip) => state.selectedIds.has(trip.id))
			const total = selectedTrips.reduce((sum, trip) => sum + trip.fare, 0)
			summary.textContent = `Selected: ${state.selectedIds.size} transactions, € ${total.toFixed(2).replace(".", ",")}`
		}

		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Frequent trips"))
		const commonTrips = {}
		for (const trip of trips) {
			const key = `${trip.isWeekDay ? "" : "Weekend "}${trip.company}: ${trip.from}-${trip.to}`;
			const returnTripKey = `${trip.isWeekDay ? "" : "Weekend "}${trip.company}: ${trip.to}-${trip.from}`;
			if (commonTrips[returnTripKey] && !commonTrips[key]) {
				commonTrips[returnTripKey].push(trip);
			} else {
				commonTrips[key] ??= []
				commonTrips[key].push(trip);
			}
		}

		// Sort common trips by frequency
		const sortedCommonTrips = Object.entries(commonTrips).sort((a, b) => b[1].length - a[1].length).filter(trip => trip[1].length > 1);

		function toggleButton(button, ids) {
			const select = !button.classList.contains("selected")
			button.classList.toggle("selected", select)
			for (const id of ids) {
				if (select) {
					state.selectedIds.add(id)
				} else {
					state.selectedIds.delete(id)
				}
			}
			updateSummary()
		}

		function createButton(key, trips) {
			const button = document.createElement("button");
			const tripLocations = new Set(trips.map(trip => trip.from));
			const tripType = tripLocations.size > 1 ? "return" : "one way";
			if (key.includes("Weekend")) {
				const span = document.createElement("span")
				span.textContent = "Weekend "
				span.classList.add("weekend")
				button.appendChild(span)
			}
			const middleSpan = document.createElement("span")
			middleSpan.textContent = key.replace("Weekend ", "")
			button.appendChild(middleSpan)

			if (trips.length > 1) {
				const span = document.createElement("span")
				span.textContent = ` (${trips.length} trips, ${tripType})`
				button.appendChild(span)
			}

			button.addEventListener("click", () => toggleButton(button, trips.map((trip) => trip.id)))
			return button
		}

		for (const [key, trips] of sortedCommonTrips) {
			container.appendChild(createButton(key, trips));
		}
		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Single trips"))
		const sortedSingleTrips = Object.entries(commonTrips).sort((a, b) => b[1][0].dateTime.localeCompare(a[1][0].dateTime)).filter(trip => trip[1].length === 1);
		let lastDate = null
		for (const [key, trips] of sortedSingleTrips) {
			const date = formatDate(trips[0].dateTime)
			if (date !== lastDate) {
				container.appendChild(createP(`${date}${trips[0].isWeekDay ? "" : " (Weekend!)"}`))
				lastDate = date
			}
			container.appendChild(createButton(key, trips));
		}

		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Unmatched events"))
		for (const event of unmatchedEvents) {
			const button = document.createElement("button")
			button.textContent = `${formatDate(event.transactionDateTime)} - ${event.modalityType} ${event.publicTransportOperator}: ${event.transactionInfo} ${event.transactionName}`
			button.addEventListener("click", () => toggleButton(button, [event.transactionId]))
			container.appendChild(button)
		}

		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Download"))
		updateSummary()
		container.appendChild(summary)
		for (const [label, documentFormat, extension] of [["PDF", "PORTABLE_DOCUMENT_FORMAT", "pdf"], ["CSV", "COMMA_SEPARATED_VALUE", "csv"]]) {
			const downloadButton = document.createElement("button")
			downloadButton.textContent = `Download ${label}`
			downloadButton.addEventListener("click", async () => {
				if (state.selectedIds.size === 0) {
					alert("Select at least one trip first")
					return
				}
				downloadButton.disabled = true
				try {
					await downloadDocument(documentFormat, extension)
				} catch (e) {
					alert(`Download failed: ${e.message}`)
				} finally {
					downloadButton.disabled = false
				}
			})
			container.appendChild(downloadButton)
		}
	}
})()
