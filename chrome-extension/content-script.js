(async () => {
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

	setInterval(async () => {
		if (document.getElementById("extension-div")) {
			return
		}
		if (!(document.location.href.includes("mijn-ov-reishistorie") || document.location.href.includes("my-travel-history"))) {
			return
		}
		console.log("searching for table")
		const table = document.querySelector(".ag-root .ag-row input[type='checkbox']")
		if (table) {
			await renderExtensionDiv()
		}
	}, 100)



	async function renderExtensionDiv() {
		if (document.getElementById("extension-div")) {
			// div already exists
			return
		}
		document.body.removeAttribute("data-last-selected-month")

		const div = document.createElement("div")
		div.id = "extension-div"
		div.classList.add("extension-div")
		document.querySelectorAll("main div:not([class])")[1].childNodes[0].appendChild(div)

		const h3 = createH3("OV Chipkaart Rapid Declarations")
		h3.prepend(createImage("android-chrome-192x192.png"))
		div.appendChild(h3)
		div.appendChild(createP("This is a chrome extension to quickly file expense reports. The original website is a pain in the ass to use, so this extension aims to fix that."))
		div.appendChild(document.createElement("hr"))

		const buttonContainer = document.createElement("div")
		div.appendChild(buttonContainer)
		const selectorContainer = document.createElement("div")
		selectorContainer.classList.add("extension-selector-container")
		div.appendChild(selectorContainer)

		// Generate a list of dates for each first day of the month for the previous 12 months
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

		// Create buttons for each date
		dates.forEach(date => {
			const button = document.createElement("button");
			button.textContent = date[2];
			button.addEventListener("click", async (event) => navigateToDate(date, event));
			buttonContainer.appendChild(button);
		});


		async function navigateToDate(date, event) {
			document.body.setAttribute("data-last-selected-month", date[2])
			for (const button of buttonContainer.children) {
				button.classList.remove("selected")
			}
			event.target.classList.add("selected")
			document.querySelector(".extension-selector-container").innerHTML = ""
			const startDate = document.querySelector("input#startDate")
			startDate.value = date[0]
			startDate.dispatchEvent(new Event("change", { bubbles: true }))
			await sleep(1000)
			const endDate = document.querySelector("input#endDate")
			endDate.value = date[1]
			endDate.dispatchEvent(new Event("change", { bubbles: true }))
			await sleep(300)
			await extractData()
		}

		// Kick-start the first extraction on load
		await sleep(1000)
		await extractData()
	}

	function parseRow(row) {
		let cols = row.querySelectorAll(".ag-cell")
		let dayOfWeek = cols[0].textContent.trim().split(" ")[0].toLowerCase()
		let ddMmYyyy = cols[0].textContent.trim().split(" ")[1]
		let time = cols[1].textContent
		let hour = parseInt(time.split(":")[0], 10)
		let place = cols[2].textContent
		let transactionType = cols[3].textContent
		let company = null
		if (transactionType.startsWith("Check-in")) {
			transactionType = "Check-in"
			company = cols[3].textContent.trim().replace("Check-in", "").trim()
		} else if (transactionType.startsWith("Check-uit") || transactionType.startsWith("Check-out")) {
			transactionType = "Check-uit"
			company = cols[3].textContent.trim().replace("Check-uit", "").replace("Check-out", "").trim()
		}
		let price = cols[4].textContent
		if (price.startsWith("€")) {
			price = parseFloat(price.replace("€", "").replace(",", ".").trim())
		} else {
			price = null
		}
		let isWeekDay = dayOfWeek !== "zaterdag" && dayOfWeek !== "zondag" && dayOfWeek !== "sunday" && dayOfWeek !== "saturday"
		if ((dayOfWeek === "zaterdag" || dayOfWeek === "saturday") && hour < 7) {
			isWeekDay = true
		}
		return {
			dayOfWeek,
			ddMmYyyy,
			time,
			place,
			transactionType,
			price,
			company,
			isWeekDay,
			row,
		}
	}


	function getAllSingleEvents() {
		const rows = document.querySelectorAll(".ag-row")
		const data = []
		for (const row of rows) {
			data.push(parseRow(row))
		}
		return data.reverse()
	}

	function getAllTrips() {
		const data = getAllSingleEvents()
		const unMatchedEvents = []
		const matchedTrips = []
		let currentOutStandingCheckIn = null
		for (const row of data) {
			if (row.transactionType.startsWith("Saldo") || row.transactionType.startsWith("Credit")) {
				continue
			}
			if (row.transactionType === "Check-in") {
				if (currentOutStandingCheckIn) {
					unMatchedEvents.push(currentOutStandingCheckIn)
					currentOutStandingCheckIn = null
				}
				currentOutStandingCheckIn = row
			} else if (row.transactionType === "Check-uit") {
				if (currentOutStandingCheckIn) {
					if (currentOutStandingCheckIn.company === row.company) {
						if (row.price) {
							matchedTrips.push({type: "combinedEvent", checkIn: currentOutStandingCheckIn, checkOut: row})
						} else {
							// this is a free trip
						}
						currentOutStandingCheckIn = null
					} else {
						unMatchedEvents.push(currentOutStandingCheckIn)
						unMatchedEvents.push(row)
						currentOutStandingCheckIn = null
					}
				} else {
					unMatchedEvents.push(row)
				}
			} else {
				unMatchedEvents.push(row)
			}
		}
		return {
			matchedTrips,
			unMatchedEvents,
		}
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

	async function extractData() {
		const selectAllCheckbox = document.querySelector(".ag-root input[type='checkbox']")
		if (selectAllCheckbox.checked) {
			selectAllCheckbox.click() // un-select all by default
		}
		const {matchedTrips, unMatchedEvents} = getAllTrips()

		const container = document.querySelector(".extension-selector-container")
		container.innerHTML = ""

		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Frequent trips"))
		const commonTrips = {}
		for (const tripData of matchedTrips) {
			// const formattedPrice = parseFloat(tripData.checkOut.price).toFixed(2).replace('.', ',');
			const key = `${tripData.checkIn.isWeekDay ? "": "Weekend "}${tripData.checkIn.company}: ${tripData.checkIn.place}-${tripData.checkOut.place}`;
			const returnTripKey = `${tripData.checkOut.isWeekDay ? "" : "Weekend "}${tripData.checkOut.company}: ${tripData.checkOut.place}-${tripData.checkIn.place}`;
			if (!commonTrips[key] && !commonTrips[returnTripKey]) {
				commonTrips[key] = [];
				commonTrips[key].push(tripData);
			} else if (commonTrips[key]) {
				commonTrips[key].push(tripData);
			} else if (commonTrips[returnTripKey]) {
				commonTrips[returnTripKey].push(tripData);
			}
		}

		// Sort common trips by frequency
		const sortedCommonTrips = Object.entries(commonTrips).sort((a, b) => b[1].length - a[1].length).filter(trip => trip[1].length > 1);

		function toggleMultiTripButton(event, trips) {
			let button = event.target.closest("button")
			let currentlySelected = button.classList.contains("selected")
			if (currentlySelected) {
				button.classList.remove("selected")
			} else {
				button.classList.add("selected")
			}
			for (const tripData of trips) {
				let querySelector = "input[type='checkbox']"
				if (currentlySelected) {
					querySelector += ":checked"
				} else {
					querySelector += ":not(:checked)"
				}
				tripData.checkIn.row.querySelector(querySelector)?.click();
				tripData.checkOut.row.querySelector(querySelector)?.click();
			}
		}

		function createButton(key, trips) {
			const button = document.createElement("button");
			const tripLocations = new Set(trips.map(trip => trip.checkIn.place));
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

			return button
		}

		for (const [key, trips] of sortedCommonTrips) {
			const button = createButton(key, trips)
			button.addEventListener("click", (event) => toggleMultiTripButton(event, trips));
			container.appendChild(button);
		}
		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Single trips"))
		const sortedSingleTrips = Object.entries(commonTrips).sort((a, b) => b[1][0].checkIn.ddMmYyyy.localeCompare(a[1][0].checkIn.ddMmYyyy)).filter(trip => trip[1].length === 1);
		let lastDate = null
		for (const [key, trips] of sortedSingleTrips) {
			if (trips[0].checkIn.ddMmYyyy !== lastDate) {
				container.appendChild(createP(`${trips[0].checkIn.dayOfWeek} - ${trips[0].checkIn.ddMmYyyy}${trips[0].checkIn.isWeekDay ? "" : " (Weekend!)"}`))
				lastDate = trips[0].checkIn.ddMmYyyy
			}
			const button = createButton(key, trips)
			button.addEventListener("click", (event) => toggleMultiTripButton(event, trips));
			container.appendChild(button);
		}

		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Unmatched events"))
		for (const event of unMatchedEvents) {
			const button = document.createElement("button")
			button.textContent = `${event.ddMmYyyy} - ${event.company}: ${event.place} ${event.transactionType}`
			button.addEventListener("click", () => {
				event.row.querySelector("input[type='checkbox']:not(:checked)")?.click();
			})
			container.appendChild(button)
		}
		container.appendChild(document.createElement("hr"))
		container.appendChild(createH3("Download PDF"))
		const downloadButton = document.createElement("button")
		downloadButton.textContent = "Instant PDF"
		downloadButton.addEventListener("click", async () => {
			let wrapper = document.getElementById("extension-div").parentElement.parentElement.parentElement;
			wrapper.querySelector("button[role=button]").click()
			await sleep(300)
			for (const button of wrapper.querySelectorAll("button[role='button']")) {
				if (button.textContent.includes("Download PDF")) {
					button.click()
					break
				}
			}
		})
		container.appendChild(downloadButton)
	}
})()