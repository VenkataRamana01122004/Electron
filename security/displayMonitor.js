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

function detectScreenDuplication() {
    try {
        const displays = screen.getAllDisplays();

        if (displays.length < 2) {
            return {
                duplicated: false,
                message: "Single display detected."
            };
        }

        for (let i = 0; i < displays.length; i++) {
            for (let j = i + 1; j < displays.length; j++) {
                const d1 = displays[i];
                const d2 = displays[j];

                const sameBounds =
                    d1.bounds.x === d2.bounds.x &&
                    d1.bounds.y === d2.bounds.y &&
                    d1.bounds.width === d2.bounds.width &&
                    d1.bounds.height === d2.bounds.height;

                const sameResolution =
                    d1.size.width === d2.size.width &&
                    d1.size.height === d2.size.height;

                if (sameBounds || sameResolution) {
                    return {
                        duplicated: true,
                        message: "Possible mirrored/duplicated display detected.",
                        displays: [d1.id, d2.id]
                    };
                }
            }
        }

        return {
            duplicated: false,
            message: "No duplicated display detected."
        };

    } catch (err) {
        return {
            duplicated: false,
            message: err.message
        };
    }
}

const { execSync } = require("child_process");

function detectHDMIDisplay() {
    try {
        const output = execSync(
            'powershell -Command "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorConnectionParams | Select-Object -ExpandProperty VideoOutputTechnology"',
            { encoding: "utf8" }
        );

        const technologies = output
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        // HDMI values commonly reported by Windows
        const hdmiDetected = technologies.some(
            tech => tech === "5" || tech === "11"
        );

        return {
            hdmiDetected,
            technologies
        };
    } catch (error) {
        return {
            hdmiDetected: false,
            technologies: [],
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

        const duplicationCheck = detectScreenDuplication();

        if (duplicationCheck.duplicated) {
            return {
                passed: false,
                message: duplicationCheck.message,
                displayCount: information.displayCount,
                displays: information.displays
            };
        }

        const hdmiCheck = detectHDMIDisplay();

        if (hdmiCheck.hdmiDetected) {
            return {
                passed: false,
                message: "External HDMI display detected.",
                displayCount: information.displayCount,
                displays: information.displays
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
        return {
            passed: false,
            message: error.message,
            displayCount: 0,
            displays: []
        };
    }
}

module.exports = { getDisplayInformation, checkDisplay };