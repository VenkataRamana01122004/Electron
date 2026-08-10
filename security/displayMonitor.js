const { screen } = require("electron");

function getDisplayInformation() {
    try {
        const displays = screen.getAllDisplays();
        const primaryDisplay = screen.getPrimaryDisplay();

        return {
            displayCount: displays.length,
            multipleDisplays: displays.length > 1,
            displays: displays.map(display => ({
                id: display.id,
                bounds: display.bounds,
                workArea: display.workArea,
                size: {
                    width: display.size.width,
                    height: display.size.height
                },
                scaleFactor: display.scaleFactor,
                rotation: display.rotation,
                internal: display.internal,
                primary: display.id === primaryDisplay.id
            }))
        };
    } catch (error) {
        console.error("Display detection error:", error);

        return {
            displayCount: 0,
            multipleDisplays: false,
            displays: [],
            error: error.message
        };
    }
}

function checkDisplay() {
    try {
        const information = getDisplayInformation();

        if (information.displayCount === 0) {
            return {
                passed: false,
                message: "No display detected.",
                displayCount: 0,
                displays: []
            };
        }

        if (information.multipleDisplays) {
            return {
                passed: false,
                message: `${information.displayCount} displays detected. Only one display is allowed.`,
                displayCount: information.displayCount,
                displays: information.displays
            };
        }

        return {
            passed: true,
            message: "Only one display detected.",
            displayCount: information.displayCount,
            displays: information.displays
        };
    } catch (error) {
        console.error("Display check error:", error);

        return {
            passed: false,
            message: error.message,
            displayCount: 0,
            displays: []
        };
    }
}

module.exports = { getDisplayInformation, checkDisplay };