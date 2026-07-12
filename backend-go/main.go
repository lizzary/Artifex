package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	stdlog "log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"artifex-backend/internal/applog"
	"artifex-backend/internal/cli"
	"artifex-backend/internal/database"
	"artifex-backend/internal/server"
	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"

	"github.com/mattn/go-isatty"
)

var version = "dev"

type options struct {
	host         string
	port         int
	portAttempts int
	baseDir      string
	dbPath       string
	uploadsDir   string
	modelsDir    string
	frontendDir  string
	settingsPath string
	cliTheme     string
	noUI         bool
}

type appRuntime struct {
	mu         sync.Mutex
	httpServer *http.Server
	done       chan error
	opts       options
	log        *applog.Hub
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Artifex:", err)
		os.Exit(1)
	}
}

func run() error {
	opts := parseOptions()
	interactive := !opts.noUI && isTerminal(os.Stdin) && isTerminal(os.Stdout)

	hub := applog.New(3000, nil)
	if !interactive {
		hub = applog.New(3000, os.Stdout)
	}
	applog.SetDefault(hub)
	stdlog.SetFlags(0)
	stdlog.SetOutput(hub.Writer("app", applog.LevelWarn))

	opts.portAttempts = cli.LoadPortAttempts(opts.settingsPath)

	mode := cli.LoadTheme(opts.settingsPath)
	if opts.cliTheme != "" {
		parsed, err := cli.ParseTheme(opts.cliTheme)
		if err != nil {
			return err
		}
		mode = parsed
	}

	rt := &appRuntime{
		done: make(chan error, 1),
		opts: opts,
		log:  hub,
	}

	if interactive {
		err := cli.Run(cli.Config{
			Version:      version,
			Theme:        mode,
			ConfigPath:   opts.settingsPath,
			PortAttempts: opts.portAttempts,
			Log:          hub,
			Bootstrap:    rt.bootstrap,
			OpenURL:      openBrowser,
		})
		shutdownErr := rt.shutdown()
		if err != nil {
			return fmt.Errorf("terminal UI failed: %w", err)
		}
		return shutdownErr
	}

	result := rt.bootstrap()
	if result.Err != nil {
		return result.Err
	}
	return rt.waitPlain()
}

func parseOptions() options {
	host := flag.String("host", "127.0.0.1", "Host to listen on")
	port := flag.Int("port", 8000, "Port to listen on")
	dbPath := flag.String("db", "", "Path to SQLite database (default: <basedir>/gallery.db)")
	uploadsDir := flag.String("uploads", "", "Path to uploads directory (default: <basedir>/uploads)")
	modelsDir := flag.String("models", "", "Path to models directory (default: <basedir>/models)")
	frontendDir := flag.String("frontend", "", "Path to frontend build directory")
	cliTheme := flag.String("cli-theme", "", "Terminal appearance: auto, dark, or light")
	noUI := flag.Bool("no-ui", false, "Disable the interactive terminal interface")
	flag.Parse()

	baseDir := "."
	if execPath, err := os.Executable(); err == nil {
		baseDir = filepath.Dir(execPath)
	}
	if wd, err := os.Getwd(); err == nil {
		_, settingsErr := os.Stat(filepath.Join(wd, "settings.json"))
		_, moduleErr := os.Stat(filepath.Join(wd, "go.mod"))
		if settingsErr == nil || moduleErr == nil {
			baseDir = wd
		}
	}

	if *dbPath == "" {
		*dbPath = filepath.Join(baseDir, "gallery.db")
	}
	if *uploadsDir == "" {
		*uploadsDir = filepath.Join(baseDir, "uploads")
	}
	if *modelsDir == "" {
		*modelsDir = filepath.Join(baseDir, "models")
	}
	if *frontendDir == "" {
		frontendCandidates := []string{
			filepath.Join(baseDir, "_internal", "frontend"),
			filepath.Join(baseDir, "frontend"),
		}
		for _, candidate := range frontendCandidates {
			if frontendExists(candidate) {
				*frontendDir = candidate
				break
			}
		}
		if *frontendDir == "" {
			devFrontend := filepath.Join(baseDir, "..", "frontend", "build")
			if abs, err := filepath.Abs(devFrontend); err == nil {
				devFrontend = abs
			}
			if _, err := os.Stat(devFrontend); err == nil {
				*frontendDir = devFrontend
			}
		}
	}

	settingsPath := filepath.Join(baseDir, "settings.json")
	return options{
		host:         *host,
		port:         *port,
		portAttempts: cli.DefaultPortAttempts,
		baseDir:      baseDir,
		dbPath:       *dbPath,
		uploadsDir:   *uploadsDir,
		modelsDir:    *modelsDir,
		frontendDir:  *frontendDir,
		settingsPath: settingsPath,
		cliTheme:     *cliTheme,
		noUI:         *noUI,
	}
}

func (rt *appRuntime) bootstrap() cli.BootResult {
	result := cli.BootResult{
		DatabasePath: rt.opts.dbPath,
		FrontendPath: rt.opts.frontendDir,
		TaggerStatus: "disabled",
	}

	rt.log.Info("startup", "initializing database")
	if err := database.InitDB(rt.opts.dbPath); err != nil {
		result.Err = fmt.Errorf("initialize database: %w", err)
		rt.log.Error("database", "%v", result.Err)
		return result
	}
	rt.log.Info("database", "ready at %s", rt.opts.dbPath)

	st, err := settings.Load(rt.opts.settingsPath)
	if err != nil {
		rt.log.Warn("settings", "could not load settings: %v", err)
	}
	tagger.SetUseGPU(st.GPUEnabled)
	if st.ActiveModel != "" {
		tagger.SetActiveModel(st.ActiveModel)
	}

	if st.AutoTag {
		rt.log.Info("startup", "loading tagger model")
		if err := tagger.LoadTagger(rt.opts.modelsDir); err != nil {
			result.TaggerStatus = "unavailable"
			result.TaggerWarning = true
			rt.log.Warn("tagger", "%v; auto-tagging will be skipped", err)
		} else {
			result.TaggerStatus = "ready"
		}
	} else {
		result.TaggerDisabled = true
		rt.log.Info("tagger", "disabled in settings")
	}

	result.FrontendReady = frontendExists(rt.opts.frontendDir)
	if !result.FrontendReady {
		rt.log.Warn("frontend", "build files not found at %s", rt.opts.frontendDir)
	}

	srv := server.NewServer(server.ServerConfig{
		BaseDir:      rt.opts.baseDir,
		UploadsDir:   rt.opts.uploadsDir,
		ModelsDir:    rt.opts.modelsDir,
		SettingsPath: rt.opts.settingsPath,
		FrontendDir:  rt.opts.frontendDir,
		Log:          rt.log,
	})

	listener, selectedPort, attempts, err := listenOnAvailablePort(
		rt.opts.host,
		rt.opts.port,
		rt.opts.portAttempts,
		net.Listen,
	)
	if err != nil {
		result.Err = err
		rt.log.Error("server", "%v", result.Err)
		return result
	}
	addr := net.JoinHostPort(rt.opts.host, strconv.Itoa(selectedPort))
	if attempts > 1 {
		rt.log.Warn(
			"server",
			"port %d was unavailable; using port %d after %d attempts",
			rt.opts.port,
			selectedPort,
			attempts,
		)
	}

	httpServer := &http.Server{
		Addr:         addr,
		Handler:      srv.Router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	rt.mu.Lock()
	rt.httpServer = httpServer
	rt.mu.Unlock()

	actualPort := rt.opts.port
	if tcpAddr, ok := listener.Addr().(*net.TCPAddr); ok {
		actualPort = tcpAddr.Port
	}
	result.URL = displayURL(rt.opts.host, actualPort)
	rt.log.Info("server", "gallery ready at %s", result.URL)
	if rt.opts.frontendDir != "" {
		rt.log.Info("frontend", "serving %s", rt.opts.frontendDir)
	}

	go func() {
		err := httpServer.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		if err != nil {
			rt.log.Error("server", "stopped unexpectedly: %v", err)
		}
		select {
		case rt.done <- err:
		default:
		}
	}()

	return result
}

type listenFunc func(network, address string) (net.Listener, error)

func listenOnAvailablePort(host string, startPort, maxAttempts int, listen listenFunc) (net.Listener, int, int, error) {
	if startPort < 0 || startPort > 65535 {
		return nil, 0, 0, fmt.Errorf("invalid port %d: must be between 0 and 65535", startPort)
	}
	if maxAttempts < 1 {
		return nil, 0, 0, fmt.Errorf("invalid port attempt limit %d: must be at least 1", maxAttempts)
	}

	port := startPort
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		addr := net.JoinHostPort(host, strconv.Itoa(port))
		listener, err := listen("tcp", addr)
		if err == nil {
			return listener, port, attempt, nil
		}
		if !isAddressInUse(err) {
			return nil, 0, attempt, fmt.Errorf("listen on %s: %w", addr, err)
		}
		lastErr = err
		if port == 65535 {
			return nil, 0, attempt, fmt.Errorf(
				"listen starting at port %d: stopped after %d attempts because the port range ends at 65535: %w",
				startPort,
				attempt,
				lastErr,
			)
		}
		port++
	}

	return nil, 0, maxAttempts, fmt.Errorf(
		"listen on ports %d-%d: all %d attempts failed because the ports are in use: %w",
		startPort,
		port-1,
		maxAttempts,
		lastErr,
	)
}

func isAddressInUse(err error) bool {
	if errors.Is(err, syscall.EADDRINUSE) {
		return true
	}
	// Go's syscall.EADDRINUSE on Windows is an invented compatibility value,
	// while net.Listen wraps the real WinSock WSAEADDRINUSE value (10048).
	return runtime.GOOS == "windows" && errors.Is(err, syscall.Errno(10048))
}

func (rt *appRuntime) waitPlain() error {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	select {
	case <-sigCh:
		rt.log.Info("server", "shutdown requested")
		return rt.shutdown()
	case err := <-rt.done:
		return err
	}
}

func (rt *appRuntime) shutdown() error {
	rt.mu.Lock()
	httpServer := rt.httpServer
	rt.mu.Unlock()
	if httpServer == nil {
		return nil
	}

	rt.log.Info("server", "shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		return fmt.Errorf("shutdown server: %w", err)
	}
	rt.log.Info("server", "stopped")
	return nil
}

func frontendExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(path, "index.html"))
	return err == nil && !info.IsDir()
}

func displayURL(host string, port int) string {
	displayHost := strings.Trim(host, "[]")
	if displayHost == "" || displayHost == "0.0.0.0" || displayHost == "::" {
		displayHost = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(displayHost, strconv.Itoa(port))
}

func isTerminal(file *os.File) bool {
	fd := file.Fd()
	return isatty.IsTerminal(fd) || isatty.IsCygwinTerminal(fd)
}

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	return command.Start()
}
