const { checkDisplay } = require("./displayMonitor");
const { getSystemInformation } = require("./systemInfo");
const { checkCamera } = require("./cameraMonitor");
const { checkScreenSharing } = require("./screenShareMonitor");
const { checkProcesses } = require("./processMonitor");

async function runSecurityChecks() {
    const results = [];

    try {
        const system = await getSystemInformation();

        results.push({
            id: "system",
            name: "System Check",
            passed: true,
            message: "System information collected.",
            details: system
        });
    } catch (error) {
        console.error("System check failed:", error);

        results.push({
            id: "system",
            name: "System Check",
            passed: false,
            message: error.message,
            details: null
        });
    }

    try {
        const display = checkDisplay();

        results.push({
            id: "display",
            name: "Display / Monitor Check",
            passed: display.passed,
            message: display.message,
            details: display
        });
    } catch (error) {
        console.error("Display check failed:", error);

        results.push({
            id: "display",
            name: "Display / Monitor Check",
            passed: false,
            message: error.message,
            details: null
        });
    }

    try {
        const camera = await checkCamera();

        results.push({
            id: "camera",
            name: "Camera Check",
            passed: camera.passed,
            message: camera.message,
            details: camera
        });
    } catch (error) {
        console.error("Camera check failed:", error);

        results.push({
            id: "camera",
            name: "Camera Check",
            passed: false,
            message: error.message,
            details: null
        });
    }

    try {
        const processes = await checkProcesses();

        results.push({
            id: "process",
            name: "Background Application Check",
            passed: processes.passed,
            message: processes.message,
            details: processes
        });
    } catch (error) {
        console.error("Process check failed:", error);

        results.push({
            id: "process",
            name: "Background Application Check",
            passed: false,
            message: error.message,
            details: null
        });
    }

    try {
        const screenShare = await checkScreenSharing();

        results.push({
            id: "screenShare",
            name: "Screen Sharing Check",
            passed: screenShare.passed,
            message: screenShare.message,
            details: screenShare
        });
    } catch (error) {
        console.error("Screen sharing check failed:", error);

        results.push({
            id: "screenShare",
            name: "Screen Sharing Check",
            passed: false,
            message: error.message,
            details: null
        });
    }

    const allPassed = results.length > 0 && results.every(result => result.passed === true);

    console.log("========================================");
    console.log("SECURITY CHECK RESULT");
    console.log("========================================");

    results.forEach(result => {
        console.log(`${result.passed ? "PASS" : "FAIL"} | ${result.name} | ${result.message}`);
    });

    console.log("========================================");
    console.log(`ALL CHECKS PASSED: ${allPassed}`);
    console.log("========================================");

    return {
        passed: allPassed,
        results
    };
}

module.exports = { runSecurityChecks };