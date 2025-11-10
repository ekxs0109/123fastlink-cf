// ==UserScript==
// @name         夸克网盘秒传JSON生成器
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  在夸克网盘生成秒传JSON文件（含MD5），支持递归获取文件夹
// @author       Your Name
// @match        https://pan.quark.cn/*
// @match        https://drive.quark.cn/*
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// @connect      drive.quark.cn
// @connect      drive-pc.quark.cn
// ==/UserScript==

(function () {
  "use strict";

  // 工具函数
  const utils = {
    // 延迟函数
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    // 查找 React Fiber 节点
    findReact(dom, traverseUp = 0) {
      let key = Object.keys(dom).find((key) => {
        return (
          key.startsWith("__reactFiber$") ||
          key.startsWith("__reactInternalInstance$")
        );
      });

      let domFiber = dom[key];

      if (domFiber == null) {
        return null;
      }

      if (domFiber._currentElement) {
        let compFiber = domFiber._currentElement._owner;
        for (let i = 0; i < traverseUp; i++) {
          compFiber = compFiber._currentElement._owner;
        }
        return compFiber._instance;
      }

      const GetCompFiber = (fiber) => {
        let parentFiber = fiber.return;
        while (typeof parentFiber.type === "string") {
          parentFiber = parentFiber.return;
        }
        return parentFiber;
      };

      let compFiber = GetCompFiber(domFiber);
      for (let i = 0; i < traverseUp; i++) {
        compFiber = GetCompFiber(compFiber);
      }

      return compFiber.stateNode || compFiber;
    },

    // 获取当前所在文件夹的路径
    getCurrentPath() {
      try {
        // 从URL中获取路径信息
        const urlParams = new URLSearchParams(window.location.search);
        const dirFid = urlParams.get("dir_fid");

        // 如果在根目录
        if (!dirFid || dirFid === "0") {
          return "";
        }

        // 尝试从页面面包屑导航获取路径
        const breadcrumb = document.querySelector(".breadcrumb-list");
        if (breadcrumb) {
          const items = breadcrumb.querySelectorAll(".breadcrumb-item");
          const pathParts = [];

          // 跳过第一个（通常是"全部文件"）
          for (let i = 1; i < items.length; i++) {
            const text = items[i].textContent.trim();
            if (text) {
              pathParts.push(text);
            }
          }

          return pathParts.join("/");
        }

        return "";
      } catch (e) {
        return "";
      }
    },

    // 获取选中的文件列表
    getSelectedList() {
      try {
        const fileListDom = document.getElementsByClassName("file-list")[0];

        if (!fileListDom) {
          return [];
        }

        const reactObj = this.findReact(fileListDom);

        const props = reactObj?.props;

        if (props) {
          const fileList = props.list || [];
          const selectedKeys = props.selectedRowKeys || [];

          const selectedList = [];
          fileList.forEach(function (val) {
            if (selectedKeys.includes(val.fid)) {
              selectedList.push(val);
            }
          });

          return selectedList;
        }

        return [];
      } catch (e) {
        return [];
      }
    },

    // 使用 GM_xmlhttpRequest 发送POST请求
    post(url, data, headers = {}) {
      return new Promise((resolve, reject) => {
        const requestData = JSON.stringify(data);
        // 使用夸克客户端的 User-Agent（重要！）
        const QUARK_UA =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch";
        const defaultHeaders = {
          "Content-Type": "application/json;charset=utf-8",
          "User-Agent": QUARK_UA,
          Origin: location.origin,
          Referer: `${location.origin}/`,
          Dnt: "",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Expires: "0",
        };

        GM_xmlhttpRequest({
          method: "POST",
          url: url,
          headers: { ...defaultHeaders, ...headers },
          data: requestData,
          onload: function (response) {
            try {
              const result = JSON.parse(response.responseText);
              resolve(result);
            } catch (e) {
              reject(new Error("响应解析失败"));
            }
          },
          onerror: function (error) {
            reject(new Error("网络请求失败"));
          },
        });
      });
    },

    // 递归获取文件夹内所有文件
    async getFolderFiles(folderId, folderPath = "") {
      console.log(
        "@@@ getFolderFiles 调用, folderId:",
        folderId,
        "folderPath:",
        folderPath,
      );

      const API_URL =
        "https://drive-pc.quark.cn/1/clouddrive/file/sort?pr=ucpro&fr=pc";
      const allFiles = [];
      let page = 1;
      const pageSize = 50;

      while (true) {
        const url = `${API_URL}&pdir_fid=${folderId}&_page=${page}&_size=${pageSize}&_fetch_total=1&_fetch_sub_dirs=0&_sort=file_type:asc,updated_at:desc`;

        const result = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function (response) {
              try {
                resolve(JSON.parse(response.responseText));
              } catch (e) {
                reject(new Error("响应解析失败"));
              }
            },
            onerror: () => reject(new Error("网络请求失败")),
          });
        });

        console.log(
          "@@@ getFolderFiles API返回, code:",
          result?.code,
          "文件数:",
          result?.data?.list?.length,
        );

        if (result?.code !== 0 || !result?.data?.list) {
          break;
        }

        const items = result.data.list;
        for (const item of items) {
          const itemPath = folderPath
            ? `${folderPath}/${item.file_name}`
            : item.file_name;
          console.log(
            "@@@ 处理项目:",
            item.file_name,
            "path:",
            itemPath,
            "isDir:",
            item.dir,
            "isFile:",
            item.file,
          );

          if (item.dir) {
            // 递归获取子文件夹
            const subFiles = await this.getFolderFiles(item.fid, itemPath);
            allFiles.push(...subFiles);
          } else if (item.file) {
            allFiles.push({ ...item, path: itemPath });
          }
        }

        // 检查是否还有更多页
        if (items.length < pageSize) {
          break;
        }
        page++;
      }

      console.log("@@@ getFolderFiles 返回文件数:", allFiles.length);
      return allFiles;
    },

    // 批量获取文件下载信息（含MD5）
    async getFilesWithMd5(fileList, onProgress) {
      const API_URL =
        "https://drive.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc";
      const BATCH_SIZE = 15;

      const data = [];
      let processed = 0;
      const validFiles = fileList.filter((item) => item.file === true);

      // 创建一个 fid -> path 的映射，用于保留原有路径
      const pathMap = {};
      validFiles.forEach((file) => {
        pathMap[file.fid] = file.path;
      });

      for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
        const batch = validFiles.slice(i, i + BATCH_SIZE);
        const fids = batch.map((item) => item.fid);

        try {
          const result = await this.post(API_URL, { fids });

          if (result?.code === 31001) {
            throw new Error("请先登录网盘");
          }
          if (result?.code !== 0) {
            throw new Error(
              `获取链接失败，代码：${result.code}，消息：${result.message}`,
            );
          }

          if (result?.data) {
            // 为每个返回的文件恢复原有的 path
            const filesWithPath = result.data.map((file) => ({
              ...file,
              path: pathMap[file.fid] || file.file_name,
            }));
            data.push(...filesWithPath);
          }

          processed += batch.length;
          if (onProgress) {
            onProgress(processed, validFiles.length);
          }

          // 节流
          await this.sleep(1000);
        } catch (error) {
          throw error;
        }
      }

      return data;
    },

    // 生成秒传JSON（兼容123FastLink格式）
    generateRapidTransferJson(filesData) {
      const files = filesData.map((file) => ({
        path: file.path || file.file_name,
        etag: (file.md5 || "").toLowerCase(),
        size: file.size,
      }));

      const totalSize = files.reduce((sum, f) => sum + f.size, 0);

      return {
        scriptVersion: "3.0.3",
        exportVersion: "1.0",
        usesBase62EtagsInExport: false,
        commonPath: "",
        files: files,
        totalFilesCount: files.length,
        totalSize: totalSize,
      };
    },

    // 显示加载弹窗
    showLoadingDialog(title, message) {
      const existingDialog = document.getElementById(
        "quark-json-loading-dialog",
      );
      if (existingDialog) {
        existingDialog.remove();
      }

      const dialog = document.createElement("div");
      dialog.id = "quark-json-loading-dialog";
      dialog.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 30px; border-radius: 8px; min-width: 300px; text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">${title}</div>
                        <div id="quark-json-loading-message" style="font-size: 14px; color: #666;">${message}</div>
                        <div style="margin-top: 15px;">
                            <div style="width: 100%; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden;">
                                <div id="quark-json-progress-bar" style="width: 0%; height: 100%; background: #0d53ff; transition: width 0.3s;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
      document.body.appendChild(dialog);
      return dialog;
    },

    // 更新加载进度
    updateProgress(processed, total) {
      const messageEl = document.getElementById("quark-json-loading-message");
      const progressBar = document.getElementById("quark-json-progress-bar");
      if (messageEl) {
        messageEl.textContent = `已获取 ${processed} / ${total} 个文件信息`;
      }
      if (progressBar) {
        const percent = ((processed / total) * 100).toFixed(1);
        progressBar.style.width = `${percent}%`;
      }
    },

    // 关闭加载弹窗
    closeLoadingDialog() {
      const dialog = document.getElementById("quark-json-loading-dialog");
      if (dialog) {
        dialog.remove();
      }
    },

    // 显示结果弹窗
    showResultDialog(json) {
      const jsonStr = JSON.stringify(json, null, 2);
      const dialog = document.createElement("div");
      dialog.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 30px; border-radius: 8px; width: 80%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
                        <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">秒传JSON生成成功</div>
                        <div style="flex: 1; overflow: auto; background: #f5f5f5; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 12px; margin-bottom: 15px;">
                            <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${jsonStr}</pre>
                        </div>
                        <div style="display: flex; gap: 10px; justify-content: flex-end;">
                            <button id="quark-json-copy-btn" style="padding: 8px 20px; background: #0d53ff; color: white; border: none; border-radius: 4px; cursor: pointer;">复制JSON</button>
                            <button id="quark-json-download-btn" style="padding: 8px 20px; background: #52c41a; color: white; border: none; border-radius: 4px; cursor: pointer;">下载文件</button>
                            <button id="quark-json-close-btn" style="padding: 8px 20px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">关闭</button>
                        </div>
                    </div>
                </div>
            `;
      document.body.appendChild(dialog);

      // 复制JSON
      document.getElementById("quark-json-copy-btn").onclick = () => {
        GM_setClipboard(jsonStr);
        GM_notification({
          text: "JSON已复制到剪贴板",
          timeout: 2000,
        });
      };

      // 下载文件
      document.getElementById("quark-json-download-btn").onclick = () => {
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `quark_rapid_transfer_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        GM_notification({
          text: "JSON文件已下载",
          timeout: 2000,
        });
      };

      // 关闭弹窗
      document.getElementById("quark-json-close-btn").onclick = () => {
        dialog.remove();
      };
    },

    // 显示错误
    showError(message) {
      const dialog = document.createElement("div");
      dialog.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 30px; border-radius: 8px; min-width: 300px; text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #ff4d4f;">错误</div>
                        <div style="font-size: 14px; color: #666; margin-bottom: 20px;">${message}</div>
                        <button id="quark-json-error-close-btn" style="padding: 8px 30px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">确定</button>
                    </div>
                </div>
            `;
      document.body.appendChild(dialog);

      document.getElementById("quark-json-error-close-btn").onclick = () => {
        dialog.remove();
      };
    },
  };

  // 主要功能
  async function generateJson() {
    try {
      // 获取选中的文件/文件夹
      const selectedItems = utils.getSelectedList();
      console.log("@@@ 选中的项目:", selectedItems);
      console.log("@@@ 选中项目数:", selectedItems.length);

      if (selectedItems.length === 0) {
        utils.showError("请先勾选要生成JSON的文件或文件夹");
        return;
      }

      // 显示加载弹窗
      utils.showLoadingDialog("正在扫描文件", "准备中...");

      // 获取当前所在路径
      const currentPath = utils.getCurrentPath();
      console.log("@@@ 当前路径:", currentPath);

      // 收集所有文件（包括文件夹内的）
      const allFiles = [];
      for (const item of selectedItems) {
        console.log(
          "@@@ 处理项目:",
          item.file_name,
          "file:",
          item.file,
          "dir:",
          item.dir,
        );

        if (item.file) {
          // 直接选中的文件，需要加上当前路径
          const filePath = currentPath
            ? `${currentPath}/${item.file_name}`
            : item.file_name;
          console.log("@@@ 文件路径:", filePath);
          allFiles.push({ ...item, path: filePath });
        } else if (item.dir) {
          // 递归获取文件夹内的所有文件
          const folderPath = currentPath
            ? `${currentPath}/${item.file_name}`
            : item.file_name;
          console.log("@@@ 文件夹路径:", folderPath);
          const folderFiles = await utils.getFolderFiles(item.fid, folderPath);
          console.log("@@@ 文件夹内文件数:", folderFiles.length);
          if (folderFiles.length > 0) {
            console.log("@@@ 文件夹内第一个文件:", folderFiles[0]);
          }
          allFiles.push(...folderFiles);
        }
      }

      console.log("@@@ 收集到的总文件数:", allFiles.length);
      if (allFiles.length > 0) {
        console.log("@@@ 第一个文件示例:", allFiles[0]);
      }

      if (allFiles.length === 0) {
        utils.closeLoadingDialog();
        utils.showError("没有找到任何文件");
        return;
      }

      // 获取文件详细信息（含MD5）
      const filesData = await utils.getFilesWithMd5(
        allFiles,
        (processed, total) => {
          utils.updateProgress(processed, total);
        },
      );

      console.log("@@@ 获取MD5后的文件数:", filesData.length);
      if (filesData.length > 0) {
        console.log("@@@ 获取MD5后第一个文件:", filesData[0]);
      }

      // 生成JSON
      const json = utils.generateRapidTransferJson(filesData);

      // 关闭加载弹窗
      utils.closeLoadingDialog();

      // 显示结果
      utils.showResultDialog(json);
    } catch (error) {
      utils.closeLoadingDialog();
      utils.showError(error.message || "生成JSON失败");
      console.error("生成JSON错误:", error);
    }
  }

  // 添加按钮
  function addButton() {
    const checkAndAdd = () => {
      const container = document.querySelector(".btn-operate .btn-main");

      if (!container) {
        return false;
      }

      if (document.getElementById("quark-json-generator-btn")) {
        return true;
      }

      const button = document.createElement("div");
      button.id = "quark-json-generator-btn";
      button.className = "ant-dropdown-trigger pl-button-json";
      button.style.cssText = "display: inline-block; margin-right: 16px;";
      button.innerHTML = `
                <div class="ant-upload ant-upload-select ant-upload-select-text">
                    <button type="button" class="ant-btn ant-btn-primary" style="background: #52c41a; border-color: #52c41a;">
                        <svg style="width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px;" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
                        </svg>
                        <span>生成JSON</span>
                    </button>
                </div>
            `;

      button.querySelector("button").onclick = generateJson;
      container.insertBefore(button, container);
      console.log("@@@", container, button);
      return true;
    };

    // 轮询检查
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (checkAndAdd()) {
        clearInterval(interval);
      }
    }, 1000);

    // 10秒后停止
    setTimeout(() => {
      clearInterval(interval);
    }, 10000);
  }

  // 初始化
  function init() {
    // 只在列表页面添加按钮
    if (location.pathname.startsWith("/list")) {
      addButton();

      // 监听路由变化
      let lastUrl = location.href;
      new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          if (location.pathname.startsWith("/list")) {
            setTimeout(addButton, 500);
          }
        }
      }).observe(document.body, { subtree: true, childList: true });
    } else {
    }
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
