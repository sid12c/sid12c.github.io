// @ts-check

; (function() {
  /** @type {typeof document.querySelector} */
  const $ = document.querySelector.bind(document)
  /** @type {typeof document.querySelectorAll} */
  const $$ = document.querySelectorAll.bind(document)

  const select = {
    iframe: "#wpra-admin-ui-frame",
    menuBadge:
      "#toplevel_page_aggregator .wpra-shell-menu-badge .plugins-count",
    menuLinks: "#toplevel_page_aggregator ul a",
    currMenuLink: "#toplevel_page_aggregator ul li.current",
    /** @param {string} page */
    menuLinkFor(page) {
      return `#toplevel_page_aggregator ul a[href*="subPage=${page}"]`
    },
  }

  const ShellMessage = {
    init: "wpra:init",
    navigate: "wpra:navigate",
    wpMedia: "wpra:wpMedia",
  }

  const FrameMessage = {
    didNavigate: "wpra:didNavigate",
    setBadgeCount: "wpra:setBadgeCount",
    openUrl: "wpra:openUrl",
    wpMedia: "wpra:wpMedia",
  }

  /** Controls the app in the iframe. */
  class AppFrame {
    /** @param {HTMLIFrameElement} frame */
    constructor(frame) {
      if (frame.contentWindow === null) {
        throw new Error("frame content window is null")
      }
      this.frame = frame
      this.window = frame.contentWindow
    }

    /**
     * @param {string} type
     * @param {any} payload
     */
    send(type, payload) {
      this.window.postMessage({ type, payload }, "*")
    }

    /**
     * @param {string} type
     * @param {(payload: any) => void} handler
     */
    onReceive(type, handler) {
      window.addEventListener("message", (event) => {
        const msg = event.data ?? {}
        if (typeof msg === "object" && (msg.type ?? "") === type) {
          handler(msg.payload)
        }
      })
    }

    load() {
      this.frame.addEventListener("load", () => {
        setTimeout(() => {
          const route = parsePageUrl()
          this.send(ShellMessage.init, { route })
        }, 1)
      })
    }

    /**
     * @param {string} url
     * @param {string=} why
     */
    navigate(url, why) {
      const { page, params } = parsePageUrl(url)
      this.send(ShellMessage.navigate, { page, params, why })
    }

    /**
     * @param {string} page
     * @param {Record<string,any>} params
     * @param {string=} why
     */
    gotoPage(page, params, why = "user") {
      this.send(ShellMessage.navigate, { page, params, why })
    }
  }

  class WpraAdminApp {
    /** @param {AppFrame} frame */
    constructor(frame) {
      this.frame = frame
    }

    listenForMessages() {
      // Update the highlighted menu item when the iframe navigates, and update
      // the browser history if necessary.
      this.frame.onReceive(FrameMessage.didNavigate, (payload) => {
        if (typeof payload !== "object" || typeof payload.page !== "string") {
          console.error(FrameMessage.didNavigate, "invalid payload")
          return
        }

        const { page, params, why } = payload

        this.updateCurrMenuItem(page)

        if (why === "popstate") {
          return
        }

        const urlParams = new URLSearchParams(params ?? {})
        urlParams.set("subPage", page)
        urlParams.delete("page")
        history.pushState({}, "", `?page=aggregator&${urlParams}`)
      })

      // Update the badge count in the menu.
      this.frame.onReceive(FrameMessage.setBadgeCount, (count) => {
        if (typeof count !== "number") {
          console.error(FrameMessage.setBadgeCount, "payload is not a number")
          return
        }

        for (const badge of $$(select.menuBadge)) {
          badge.textContent = count.toString()

          if (!badge.parentElement) {
            return
          }

          if (count <= 0) {
            badge.parentElement.style.display = "none"
          } else {
            badge.parentElement.style.display = "inline-block"
          }
        }
      })

      // Open links in the main window
      this.frame.onReceive(FrameMessage.openUrl, (payload) => {
        if (typeof payload !== "object" || typeof payload.url !== "string") {
          console.error(FrameMessage.openUrl, "payload is missing url")
          return
        }

        if (payload.target) {
          window.open(payload.url, payload.target)
        } else {
          this.frame.navigate(payload.url, "openUrl")
        }
        return
      })

      this.frame.onReceive(FrameMessage.wpMedia, (payload) => {
        if (typeof payload !== "object") {
          console.error(FrameMessage.wpMedia, "payload is not an object")
          return
        }

        // @ts-ignore
        const mediaWin = wp.media(payload)

        mediaWin.on("select",  () => {
          const selection = mediaWin.state().get("selection").models
          const ids = selection.map(model => model.id)
          this.frame.send(ShellMessage.wpMedia, ids)
        });

        mediaWin.open()
      })
    }

    bindRouter() {
      for (const link of $$(select.menuLinks)) {
        if (!(link instanceof HTMLAnchorElement)) {
          continue
        }

        // Make the menu links send navigation messages to the iframe instead
        // of navigating the outer admin page.
        link.addEventListener("click", (e) => {
          if (!(e.target instanceof HTMLAnchorElement) || !Boolean(e.target?.href)) {
            e.preventDefault()
            return
          }

          const leftClick = e.button === 0

          if (leftClick && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
            this.frame.navigate(e.target.href, "user")
          }
        })
      }

      window.addEventListener("popstate", () => {
        this.frame.navigate(window.location.href, "popstate")
      })
    }

    /**
     * Updates the currently highlighted menu item.
     *
     * @param {string=} page
     */
    updateCurrMenuItem(page) {
      page = page || parsePageUrl(window.location.href).page

      if (page === "source-edit") {
        page = "sources"
      } else if (page === "display-edit") {
        page = "displays"
      } else if (!page || page === "reject-list") {
        page = "hub"
      }

      for (const li of $$(select.currMenuLink)) {
        li.classList.remove("current")
      }

      for (const a of $$(select.menuLinkFor(page))) {
        a.parentElement?.classList.add("current")
      }
    }
  }

  /**
   * Parses a URL for the current subpage and non-page query params.
   *
   * @param {string=} urlStr
   * @returns {{page: string, params: Record<string,any>}}
   */
  function parsePageUrl(urlStr) {
    urlStr = urlStr || window.location.href

    const url = new URL(urlStr)
    const params = url.searchParams
    const subPage = params.get("subPage") ?? ""

    params.delete("page")
    params.delete("subPage")

    const newParams = {}
    for (const [key, value] of params.entries()) {
      newParams[key] = value
    }

    return { page: subPage, params: newParams }
  }

  // Start the admin UI
  {
    const iframeEl = $(select.iframe)

    if (!(iframeEl instanceof HTMLIFrameElement)) {
      console.error("admin UI frame is not an iframe")
      return
    }

    const frame = new AppFrame(iframeEl)
    const admin = new WpraAdminApp(frame)

    frame.load()
    admin.bindRouter()
    admin.updateCurrMenuItem()
    admin.listenForMessages()

    // @ts-ignore
    window.WpraAdminAppFrame = frame
  }
})()
