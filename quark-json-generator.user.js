// ==UserScript==
// @name         夸克网盘秒传JSON生成器
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  在夸克网盘生成秒传JSON文件（含MD5），支持递归获取文件夹
// @author       Your Name
// @match        https://pan.quark.cn/*
// @match        https://drive.quark.cn/*
// @match        https://pan.quark.cn/s/*
// @match        https://drive.quark.cn/s/*
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @connect      drive.quark.cn
// @connect      drive-pc.quark.cn
// @connect      pc-api.uc.cn
// ==/UserScript==

(function () {
  "use strict";

  // 工具函数
  const utils = {
    // 获取缓存的Cookie
    getCachedCookie() {
      return GM_getValue("quark_cookie", "");
    },

    // 保存Cookie到缓存
    saveCookie(cookie) {
      GM_setValue("quark_cookie", cookie);
    },

    // 显示Cookie输入对话框
    showCookieInputDialog(onSave, currentCookie = "") {
      const dialog = document.createElement("div");
      dialog.id = "quark-cookie-input-dialog";
      dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;">
          <div style="background: white; padding: 30px; border-radius: 8px; width: 80%; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column;">
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px;">设置夸克网盘Cookie</div>
            <div style="font-size: 14px; color: #666; margin-bottom: 15px;">
              请打开浏览器开发者工具(F12) → Network → 找到任意请求 → 复制完整的Cookie值<br/>
              <strong>必须包含：__puus、__pus、ctoken 等关键Cookie</strong>
            </div>
            <textarea id="quark-cookie-input"
              placeholder="粘贴完整的Cookie字符串，例如：ctoken=xxx; __puus=xxx; __pus=xxx; ..."
              style="flex: 1; min-height: 200px; padding: 10px; border: 1px solid #d9d9d9; border-radius: 4px; font-family: monospace; font-size: 12px; resize: vertical;">${currentCookie}</textarea>
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;">
              <button id="quark-cookie-save-btn" style="padding: 8px 20px; background: #0d53ff; color: white; border: none; border-radius: 4px; cursor: pointer;">保存</button>
              <button id="quark-cookie-cancel-btn" style="padding: 8px 20px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">取消</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);

      // 保存按钮
      document.getElementById("quark-cookie-save-btn").onclick = () => {
        const cookie = document
          .getElementById("quark-cookie-input")
          .value.trim();
        if (!cookie) {
          alert("Cookie不能为空");
          return;
        }
        this.saveCookie(cookie);
        dialog.remove();
        GM_notification({
          text: "Cookie已保存",
          timeout: 2000,
        });
        if (onSave) {
          onSave(cookie);
        }
      };

      // 取消按钮
      document.getElementById("quark-cookie-cancel-btn").onclick = () => {
        dialog.remove();
      };
    },

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

        if (result?.code !== 0 || !result?.data?.list) {
          break;
        }

        const items = result.data.list;
        for (const item of items) {
          const itemPath = folderPath
            ? `${folderPath}/${item.file_name}`
            : item.file_name;

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

      return allFiles;
    },

    // 递归获取分享文件夹内所有文件
    async getShareFolderFiles(shareId, stoken, folderId, folderPath = "", onProgress) {
      const allFiles = [];
      let page = 1;
      const pageSize = 100;
      let processedCount = 0; // Track processed files for progress

      while (true) {
        const url = `https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pwd_id=${shareId}&stoken=${encodeURIComponent(
          stoken,
        )}&pdir_fid=${folderId}&_page=${page}&_size=${pageSize}&pr=ucpro&fr=pc`;

        const result = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            headers: {
              Referer: "https://pan.quark.cn/",
            },
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

        if (result?.code !== 0 || !result?.data?.list) {
          break;
        }

        const items = result.data.list;
        for (const item of items) {
          const itemPath = folderPath
            ? `${folderPath}/${item.file_name}`
            : item.file_name;

          if (item.dir) {
            // 递归获取子文件夹
            const subFiles = await this.getShareFolderFiles(
              shareId,
              stoken,
              item.fid,
              itemPath,
              onProgress, // Pass onProgress to recursive calls
            );
            allFiles.push(...subFiles);
          } else if (item.file) {
            allFiles.push({ ...item, path: itemPath });
            processedCount++;
            if (onProgress) {
              onProgress(processedCount);
            }
          }
        }

        // 检查是否还有更多页
        if (items.length < pageSize) {
          break;
        }
        page++;
      }

      return allFiles;
    },

    // 获取分享页面的token
    async getShareToken(shareId, passcode = "", cookie = "") {
      const API_URL = "https://pc-api.uc.cn/1/clouddrive/share/sharepage/token";

      try {
        const result = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "POST",
            url: API_URL,
            headers: {
              "Content-Type": "application/json",
              Cookie: cookie,
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: "https://pan.quark.cn/",
            },
            data: JSON.stringify({
              pwd_id: shareId,
              passcode: passcode,
            }),
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

        if (result?.code === 31001) {
          throw new Error("请先登录网盘");
        }
        if (result?.code !== 0) {
          throw new Error(
            `获取token失败，代码：${result.code}，消息：${result.message}`,
          );
        }

        return result.data.stoken;
      } catch (error) {
        throw error;
      }
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

    // 递归获取夸克分享文件列表（含MD5）- 参考serviceQuark.js
    async getQuarkShareFilesWithMd5(
      shareId,
      stoken,
      cookie,
      parentFileId = 0,
      path = "",
      onProgress, // Add onProgress callback
      processedCount = { value: 0 }, // Use an object to pass by reference
      totalFiles = { value: 0 } // Use an object to pass by reference
    ) {
      const files = [];
      let page = 1;

      while (true) {
        const url = `https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pwd_id=${shareId}&stoken=${encodeURIComponent(
          stoken,
        )}&pdir_fid=${parentFileId}&_page=${page}&_size=100&pr=ucpro&fr=pc`;

        const result = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            headers: {
              Cookie: cookie,
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
              Referer: "https://pan.quark.cn/",
            },
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

        if (result.code !== 0 || !result.data?.list) break;

        // Collect file information for batch MD5 fetching
        const fileItems = [];
        for (const item of result.data.list) {
          if (!item.dir) {
            fileItems.push({
              fid: item.fid,
              token: item.share_fid_token,
              name: item.file_name,
              size: item.size,
              path: path ? `${path}/${item.file_name}` : item.file_name,
            });
            totalFiles.value++; // Increment total files count
          }
        }

        // Batch fetch MD5s
        const md5Map = {};
        if (fileItems.length > 0) {
          const batchSize = 10;
          for (let i = 0; i < fileItems.length; i += batchSize) {
            const batch = fileItems.slice(i, i + batchSize);
            const fids = batch.map((item) => item.fid);
            const tokens = batch.map((item) => item.token);

            try {
              const requestBody = {
                fids,
                pwd_id: shareId,
                stoken,
                fids_token: tokens,
              };

              const md5Result = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                  method: "POST",
                  url: `https://pc-api.uc.cn/1/clouddrive/file/download?pr=ucpro&fr=pc&uc_param_str=&__dt=${Math.floor(Math.random() * 4 + 1) * 60 * 1000}&__t=${Date.now()}`,
                  headers: {
                    "Content-Type": "application/json",
                    Cookie: cookie,
                    "User-Agent":
                      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch",
                    Referer: "https://pan.quark.cn/",
                    Accept: "application/json, text/plain, */*",
                    Origin: "https://pan.quark.cn",
                  },
                  data: JSON.stringify(requestBody),
                  onload: function (response) {
                    try {
                      const parsed = JSON.parse(response.responseText);
                      resolve(parsed);
                    } catch (e) {
                      resolve({ code: -1, message: "解析失败" });
                    }
                  },
                  onerror: (error) => {
                    resolve({ code: -1, message: "网络错误" });
                  },
                });
              });

              if (md5Result.code === 0 && md5Result.data) {
                const dataList = Array.isArray(md5Result.data)
                  ? md5Result.data
                  : [md5Result.data];

                dataList.forEach((item, idx) => {
                  const fid = fids[idx];
                  if (!fid) return;

                  let md5 = item.md5 || item.hash || "";

                  // Base64 decode
                  if (md5 && md5.includes("==")) {
                    try {
                      const binaryString = atob(md5);
                      if (binaryString.length === 16) {
                        md5 = Array.from(binaryString, (char) =>
                          char.charCodeAt(0).toString(16).padStart(2, "0"),
                        ).join("");
                      } else {
                        md5 = "";
                      }
                    } catch (e) {
                      md5 = "";
                    }
                  }

                  md5Map[fid] = md5;
                  processedCount.value++; // Increment processed count
                  if (onProgress) {
                    onProgress(processedCount.value, totalFiles.value);
                  }
                });
              } else {
                // Cookie might be expired, return empty MD5
                fids.forEach((fid) => (md5Map[fid] = ""));
                processedCount.value += fids.length; // Still count as processed
                if (onProgress) {
                  onProgress(processedCount.value, totalFiles.value);
                }
              }
            } catch (e) {
              fids.forEach((fid) => (md5Map[fid] = ""));
              processedCount.value += fids.length; // Still count as processed
              if (onProgress) {
                onProgress(processedCount.value, totalFiles.value);
              }
            }

            await this.sleep(1000);
          }
        }

        // Process file list
        for (const item of result.data.list) {
          const itemPath = path ? `${path}/${item.file_name}` : item.file_name;

          if (item.dir) {
            // Recursively get folder content
            const subFiles = await this.getQuarkShareFilesWithMd5(
              shareId,
              stoken,
              cookie,
              item.fid,
              itemPath,
              onProgress,
              processedCount,
              totalFiles
            );
            files.push(...subFiles);
          } else {
            // File: use the fetched MD5 (hex format, lowercase)
            files.push({
              path: itemPath,
              etag: (md5Map[item.fid] || "").toLowerCase(),
              size: item.size,
            });
          }
        }

        if (result.data.list.length < 100) break;
        page++;
      }

      return files;
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
    showError(message, showCookieButton = false) {
      const dialog = document.createElement("div");
      dialog.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 30px; border-radius: 8px; min-width: 300px; text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #ff4d4f;">错误</div>
                        <div style="font-size: 14px; color: #666; margin-bottom: 20px; white-space: pre-line;">${message}</div>
                        <div style="display: flex; gap: 10px; justify-content: center;">
                            ${showCookieButton ? '<button id="quark-json-error-cookie-btn" style="padding: 8px 20px; background: #0d53ff; color: white; border: none; border-radius: 4px; cursor: pointer;">修改Cookie</button>' : ""}
                            <button id="quark-json-error-close-btn" style="padding: 8px 30px; background: #d9d9d9; color: #333; border: none; border-radius: 4px; cursor: pointer;">确定</button>
                        </div>
                    </div>
                </div>
            `;
      document.body.appendChild(dialog);

      if (showCookieButton) {
        document.getElementById("quark-json-error-cookie-btn").onclick = () => {
          dialog.remove();
          this.showCookieInputDialog(null, this.getCachedCookie());
        };
      }

      document.getElementById("quark-json-error-close-btn").onclick = () => {
        dialog.remove();
      };
    },
  };

  // 主要功能
  async function generateJson() {
    try {
      const path = location.pathname;
      const isSharePage = /^\/(s|share)\//.test(path);

      if (isSharePage) {
        // 分享页面逻辑
        await generateShareJson();
      } else {
        // 个人页面逻辑
        await generateHomeJson();
      }
    } catch (error) {
      utils.closeLoadingDialog();
      utils.showError(error.message || "生成JSON失败");
    }
  }

  // 个人页面生成JSON
  async function generateHomeJson() {
    // 获取选中的文件/文件夹
    const selectedItems = utils.getSelectedList();

    if (selectedItems.length === 0) {
      utils.showError("请先勾选要生成JSON的文件或文件夹");
      return;
    }

    // 显示加载弹窗
    utils.showLoadingDialog("正在扫描文件", "准备中...");

    // 获取当前所在路径
    const currentPath = utils.getCurrentPath();

    // 收集所有文件（包括文件夹内的）
    const allFiles = [];
    for (const item of selectedItems) {
      if (item.file) {
        // 直接选中的文件，需要加上当前路径
        const filePath = currentPath
          ? `${currentPath}/${item.file_name}`
          : item.file_name;
        allFiles.push({ ...item, path: filePath });
      } else if (item.dir) {
        // 递归获取文件夹内的所有文件
        const folderPath = currentPath
          ? `${currentPath}/${item.file_name}`
          : item.file_name;
        const folderFiles = await utils.getFolderFiles(item.fid, folderPath);
        allFiles.push(...folderFiles);
      }
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

    // 生成JSON
    const json = utils.generateRapidTransferJson(filesData);

    // 关闭加载弹窗
    utils.closeLoadingDialog();

    // 显示结果
    utils.showResultDialog(json);
  }

  // 分享页面生成JSON
  async function generateShareJson() {
    // 获取选中的文件/文件夹
    const selectedItems = utils.getSelectedList();

    // 从URL获取shareId
    const match = location.pathname.match(/\/(s|share)\/([a-zA-Z0-9]+)/);
    if (!match) {
      utils.showError("无法获取分享ID");
      return;
    }
    const shareId = match[2];

    // 获取Cookie（优先从缓存读取）
    let cookie = utils.getCachedCookie();

    if (!cookie || cookie.length < 10) {
      // 没有Cookie，显示输入对话框
      utils.showCookieInputDialog((newCookie) => {
        // 用户保存Cookie后，重新执行生成
        setTimeout(() => generateShareJson(), 100);
      });
      return;
    }

    // 显示加载弹窗
          utils.showLoadingDialog("正在扫描文件", "准备中...");
    
          const processedCount = { value: 0 };
          const totalFiles = { value: 0 };
    
          // 直接调用类似serviceQuark.js的方法获取所有文件
          const files = await utils.getQuarkShareFilesWithMd5(
            shareId,
            stoken,
            cookie,
            0,
            "",
            (processed, total) => {
              utils.updateProgress(processed, total);
            },
            processedCount,
            totalFiles
          );
      if (files.length === 0) {
        utils.closeLoadingDialog();
        utils.showError("没有找到任何文件", true);
        return;
      }

      // 生成JSON
      const json = {
        scriptVersion: "3.0.3",
        exportVersion: "1.0",
        usesBase62EtagsInExport: false,
        commonPath: "",
        files,
        totalFilesCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
      };

      // 关闭加载弹窗
      utils.closeLoadingDialog();

      // 显示结果
      utils.showResultDialog(json);
    } catch (error) {
      utils.closeLoadingDialog();
      const errorMsg = error.message || "生成JSON失败";
      // 如果是Cookie相关错误，显示修改Cookie按钮
      const isCookieError =
        errorMsg.includes("登录") ||
        errorMsg.includes("token") ||
        errorMsg.includes("Cookie") ||
        errorMsg.includes("23018");
      utils.showError(
        errorMsg +
          (isCookieError ? "\n\n可能是Cookie失效，请尝试更新Cookie" : ""),
        isCookieError,
      );
    }
  }

  // 添加按钮
  function addButton() {
    const checkAndAdd = () => {
      const path = location.pathname;
      const isSharePage = /^\/(s|share)\//.test(path);
      let container;

      // 根据页面类型选择不同的容器
      if (isSharePage) {
        container = document.querySelector(".share-btns");

        // 尝试其他可能的选择器
        if (!container) {
          const alternatives = [
            ".ant-layout-content .operate-bar",
            ".share-detail-header .operate-bar",
            ".share-header-btns",
            ".share-operate-btns",
            "[class*='share'][class*='btn']",
            ".ant-btn-group",
          ];

          for (const selector of alternatives) {
            container = document.querySelector(selector);
            if (container) break;
          }
        }
      } else {
        container = document.querySelector(".btn-operate .btn-main");
      }

      if (!container) {
        return false;
      }

      if (document.getElementById("quark-json-generator-btn")) {
        return true;
      }

      const button = document.createElement("div");
      button.id = "quark-json-generator-btn";
      button.className = "ant-dropdown-trigger pl-button-json";

      if (isSharePage) {
        // 分享页面样式
        button.style.cssText = "display: inline-block; margin-left: 16px;";
        button.innerHTML = `
                <button type="button" class="ant-btn ant-btn-primary" style="background: #52c41a; border-color: #52c41a; height: 40px;">
                    <svg style="width: 16px; height: 16px; margin-right: 4px; vertical-align: -3px;" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
                    </svg>
                    <span>生成JSON</span>
                </button>
            `;
        container.appendChild(button);
      } else {
        // 个人页面样式
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
        container.insertBefore(button, container.firstChild);
      }

      button.querySelector("button").onclick = generateJson;
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
    const path = location.pathname;
    // 在列表页面或分享页面添加按钮
    const isListPage = path.startsWith("/list");
    const isSharePage = /^\/(s|share)\//.test(path);

    if (isListPage || isSharePage) {
      addButton();

      // 监听路由变化
      let lastUrl = location.href;
      new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          const newPath = location.pathname;
          if (newPath.startsWith("/list") || /^\/(s|share)\//.test(newPath)) {
            setTimeout(addButton, 500);
          }
        }
      }).observe(document.body, { subtree: true, childList: true });
    }
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
