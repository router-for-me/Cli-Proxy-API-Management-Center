package resp

import (
	"bufio"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// newPipeClient 通过 net.Pipe 构造一对客户端/服务端连接，便于单元测试不依赖真实网络。
func newPipeClient(t *testing.T) (*Client, net.Conn) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	client := &Client{
		conn:    clientConn,
		reader:  bufio.NewReader(clientConn),
		timeout: 2 * time.Second,
	}
	t.Cleanup(func() {
		_ = clientConn.Close()
		_ = serverConn.Close()
	})
	return client, serverConn
}

func readRequest(t *testing.T, server net.Conn, want string) {
	t.Helper()
	_ = server.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, len(want))
	if _, err := io.ReadFull(server, buf); err != nil {
		t.Fatalf("read server-side command: %v", err)
	}
	if string(buf) != want {
		t.Fatalf("unexpected request: %q want %q", buf, want)
	}
}

func writeResponse(t *testing.T, server net.Conn, response string) {
	t.Helper()
	_ = server.SetWriteDeadline(time.Now().Add(time.Second))
	if _, err := server.Write([]byte(response)); err != nil {
		t.Fatalf("write server-side response: %v", err)
	}
}

func TestSubscribeSuccess(t *testing.T) {
	client, server := newPipeClient(t)
	done := make(chan error, 1)
	go func() {
		done <- client.Subscribe("usage")
	}()

	readRequest(t, server, "*2\r\n$9\r\nSUBSCRIBE\r\n$5\r\nusage\r\n")
	writeResponse(t, server, "*3\r\n$9\r\nsubscribe\r\n$5\r\nusage\r\n:1\r\n")

	if err := <-done; err != nil {
		t.Fatalf("Subscribe returned error: %v", err)
	}
	if !client.subscribed {
		t.Fatalf("client should be in subscribed state")
	}
}

func TestSubscribeUnsupportedFallsBack(t *testing.T) {
	client, server := newPipeClient(t)
	done := make(chan error, 1)
	go func() {
		done <- client.Subscribe("usage")
	}()

	readRequest(t, server, "*2\r\n$9\r\nSUBSCRIBE\r\n$5\r\nusage\r\n")
	writeResponse(t, server, "-ERR unknown command 'SUBSCRIBE'\r\n")

	err := <-done
	if !errors.Is(err, ErrUnsupportedSubscribe) {
		t.Fatalf("expected ErrUnsupportedSubscribe, got %v", err)
	}
	if client.subscribed {
		t.Fatalf("client should not be in subscribed state on unsupported")
	}
}

func TestReadMessagePayload(t *testing.T) {
	client, server := newPipeClient(t)
	client.subscribed = true

	done := make(chan struct {
		channel string
		payload string
		err     error
	}, 1)
	go func() {
		ch, payload, err := client.ReadMessage()
		done <- struct {
			channel string
			payload string
			err     error
		}{ch, payload, err}
	}()

	payload := `{"model":"gpt"}`
	writeResponse(t, server, "*3\r\n$7\r\nmessage\r\n$5\r\nusage\r\n$"+itoa(len(payload))+"\r\n"+payload+"\r\n")

	result := <-done
	if result.err != nil {
		t.Fatalf("ReadMessage error: %v", result.err)
	}
	if result.channel != "usage" {
		t.Fatalf("unexpected channel: %q", result.channel)
	}
	if result.payload != payload {
		t.Fatalf("unexpected payload: %q want %q", result.payload, payload)
	}
}

func TestReadMessageSkipsControlFrames(t *testing.T) {
	client, server := newPipeClient(t)
	client.subscribed = true

	done := make(chan struct {
		payload string
		err     error
	}, 1)
	go func() {
		_, payload, err := client.ReadMessage()
		done <- struct {
			payload string
			err     error
		}{payload, err}
	}()

	// 先注入一条二次订阅控制帧、一条 PONG（数组形式）、一条 PONG（simple string），最后才是 message。
	writeResponse(t, server, "*3\r\n$9\r\nsubscribe\r\n$5\r\nusage\r\n:1\r\n")
	writeResponse(t, server, "*1\r\n$4\r\npong\r\n")
	writeResponse(t, server, "+PONG\r\n")
	payload := `{"ok":true}`
	writeResponse(t, server, "*3\r\n$7\r\nmessage\r\n$5\r\nusage\r\n$"+itoa(len(payload))+"\r\n"+payload+"\r\n")

	result := <-done
	if result.err != nil {
		t.Fatalf("ReadMessage error: %v", result.err)
	}
	if result.payload != payload {
		t.Fatalf("unexpected payload: %q", result.payload)
	}
}

func TestReadMessageRequiresSubscription(t *testing.T) {
	client, _ := newPipeClient(t)
	_, _, err := client.ReadMessage()
	if err == nil || !strings.Contains(err.Error(), "not in subscribe mode") {
		t.Fatalf("expected subscribe-mode error, got %v", err)
	}
}

func TestSendSubscribePingWritesCommand(t *testing.T) {
	client, server := newPipeClient(t)
	client.subscribed = true

	done := make(chan error, 1)
	go func() {
		done <- client.SendSubscribePing()
	}()

	readRequest(t, server, "*1\r\n$4\r\nPING\r\n")
	if err := <-done; err != nil {
		t.Fatalf("SendSubscribePing error: %v", err)
	}
}

func TestDoRejectedInSubscribeMode(t *testing.T) {
	client, _ := newPipeClient(t)
	client.subscribed = true
	if _, err := client.Do("PING"); err == nil {
		t.Fatalf("expected error when calling Do in subscribe mode")
	}
}

// itoa 是 strconv.Itoa 的本地等价物，保留测试自包含。
func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [20]byte
	pos := len(buf)
	for value > 0 {
		pos--
		buf[pos] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
