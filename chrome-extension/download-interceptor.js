console.log("patching stuff man")
const normalAppend = document.body.append

const interceptAppend = new Proxy(normalAppend, {
	apply: function(target, thisArg, argumentsList) {
		console.log("intercepted append")
		const element = argumentsList[0];
		const lastSelectedMonth = document.body.getAttribute("data-last-selected-month")
		if (element && element.download) {
			if (lastSelectedMonth) {
				element.download = "ov-chipkaart-nl-" + lastSelectedMonth.replace(/ /g, "-") + ".pdf"
			}
		}
		return target.apply(thisArg, argumentsList);
	}
});
document.body.append = interceptAppend