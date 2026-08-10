const psListModule = require("ps-list");
const psList = psListModule.default || psListModule;

const SCREEN_SHARING_PROCESSES = [
    "obs64.exe",
    "obs.exe",
    "streamlabs obs.exe",
    "streamlabs.exe",
    "teamviewer.exe",
    "anydesk.exe",
    "rustdesk.exe",
    "supremo.exe",
    "parsec.exe",
    "remoting_host.exe",
    "chrome_remote_desktop_host.exe",
    "mstsc.exe",
    "zoom.exe",
    "ms-teams.exe",
    "teams.exe",
    "webex.exe",
    "gotomeeting.exe",
    "gotomypc.exe",
    "camtasia.exe",
    "snagit.exe",
    "bandicam.exe",
    "xsplit.core.exe",
    "xsplit.broadcaster.exe",
    "fraps.exe",
    "nvcontainer.exe",
    "nvidia share.exe",
    "nvidia overlay.exe",
    "amdow.exe",
    "spacedeskservice.exe",
    "spacedeskdriver.exe",
    "virtualdisplay.exe"
];

function normalizeName(name) {
    return String(name).toLowerCase().trim();
}

async function checkScreenSharing() {
    try {
        const processes = await psList();

        const found = processes.filter(process =>
            SCREEN_SHARING_PROCESSES.includes(normalizeName(process.name))
        );

        if (found.length > 0) {
            const names = [...new Set(found.map(process => process.name))];

            return {
                passed: false,
                message: `Screen sharing or recording application detected: ${names.join(", ")}`,
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
            message: "No known screen sharing or recording application detected.",
            processes: []
        };
    } catch (error) {
        console.error("Screen sharing detection error:", error);

        return {
            passed: false,
            message: "Unable to check for screen sharing applications.",
            error: error.message,
            processes: []
        };
    }
}

function getScreenSharingProcesses() {
    return [...SCREEN_SHARING_PROCESSES];
}

module.exports = {
    checkScreenSharing,
    getScreenSharingProcesses
};