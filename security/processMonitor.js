const psListModule = require("ps-list");
const psList = psListModule.default || psListModule;

let monitoringTimer = null;
let mainWindow = null;

const PROHIBITED_PROCESSES = [
    "chrome.exe",
    "obs64.exe",
    "obs.exe",
    "teamviewer.exe",
    "anydesk.exe",
    "discord.exe",
    "wireshark.exe",
    "fiddler.exe",
    "charles.exe",
    "processhacker.exe"
];

function normalizeName(name) {
    return String(name).toLowerCase().trim();
}

async function checkProcesses() {
    try {
        const processes = await psList();

        const found = processes.filter(process =>
            PROHIBITED_PROCESSES.includes(normalizeName(process.name))
        );

        if (found.length > 0) {
            const uniqueNames = [...new Set(
                found.map(process => normalizeName(process.name))
            )];

            for (const process of found) {
                sendEvent({
                    type: "PROHIBITED_PROCESS",
                    process: {
                        pid: process.pid,
                        name: process.name,
                        cpu: process.cpu,
                        memory: process.memory
                    },
                    timestamp: Date.now()
                });
            }

            return {
                passed: false,
                message: `Prohibited application detected: ${uniqueNames.join(", ")}`,
                processes: found.map(process => ({
                    pid: process.pid,
                    name: process.name,
                    cpu: process.cpu,
                    memory: process.memory
                }))
            };
        }

        return {
            passed: true,
            message: "No prohibited applications detected.",
            processes: []
        };
    } catch (error) {
        sendEvent({
            type: "PROCESS_MONITOR_ERROR",
            message: error.message,
            timestamp: Date.now()
        });

        console.error("PROCESS CHECK ERROR:", error);

        return {
            passed: false,
            message: "Unable to check running applications.",
            error: error.message,
            processes: []
        };
    }
}

function startProcessMonitoring(window) {
    mainWindow = window;

    if (monitoringTimer) return;

    checkProcesses().catch(error => {
        console.error("Initial process check error:", error);
    });

    monitoringTimer = setInterval(() => {
        checkProcesses().catch(error => {
            console.error("Process monitoring error:", error);
        });
    }, 3000);
}

function stopProcessMonitoring() {
    if (monitoringTimer) {
        clearInterval(monitoringTimer);
        monitoringTimer = null;
    }

    mainWindow = null;
}

function sendEvent(data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("security-event", data);
    }
}

function getProhibitedProcesses() {
    return [...PROHIBITED_PROCESSES];
}

module.exports = {
    checkProcesses,
    startProcessMonitoring,
    stopProcessMonitoring,
    getProhibitedProcesses
};