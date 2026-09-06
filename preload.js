const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    loadChrome: url => ipcRenderer.invoke("navigation:load-chrome", url),
    loadCodeChef: () => ipcRenderer.invoke("navigation:load-codechef"),
    showExitApp: () => ipcRenderer.invoke("navigation:show-exit"),
    hideExitApp: () => ipcRenderer.invoke("navigation:hide-exit"),
    endProcess: processName => ipcRenderer.invoke("system:end-process", processName),
    exitApp: () => ipcRenderer.invoke("application:exit"),
    runSecurityChecks: () => ipcRenderer.invoke("security:run-checks"),
    startExam: () => ipcRenderer.invoke("exam:start"),
    stopExam: () => ipcRenderer.invoke("exam:stop"),
    getExamState: () => ipcRenderer.invoke("exam:state"),
    finishExam: () => ipcRenderer.invoke("exam:finish"),
    exitExam: () => ipcRenderer.invoke("application:exit"),
    getSystemInfo: () => ipcRenderer.invoke("system:get-info"),
    getDisplayInfo: () => ipcRenderer.invoke("display:get-info"),
    closeChrome: () => ipcRenderer.invoke("system:close-chrome"),
    getBackgroundApplications: () => ipcRenderer.invoke("background-applications:get"),

    onSecurityEvent: callback => {
        const listener = (event, data) => callback(data);

        ipcRenderer.on("security-event", listener);

        return () => {
            ipcRenderer.removeListener("security-event", listener);
        };
    }
});