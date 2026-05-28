package resp

import (
	"bufio"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	conn       net.Conn
	reader     *bufio.Reader
	timeout    time.Duration
	subscribed bool
}

// ErrUnsupportedSubscribe 表示上游不支持 SUBSCRIBE 命令（典型为 v7.0.7 之前的 CPA）。
var ErrUnsupportedSubscribe = errors.New("RESP server does not support SUBSCRIBE")

func Dial(rawURL string, skipTLSVerify bool) (*Client, error) {
	upstream, err := parseURL(rawURL)
	if err != nil {
		return nil, err
	}
	host := upstream.Host
	if !strings.Contains(host, ":") {
		if upstream.Scheme == "https" {
			host += ":443"
		} else {
			host += ":80"
		}
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	if upstream.Scheme == "https" {
		serverName := upstream.Hostname()
		conn, err = tls.DialWithDialer(dialer, "tcp", host, &tls.Config{
			ServerName:         serverName,
			InsecureSkipVerify: skipTLSVerify,
		})
	} else {
		conn, err = dialer.Dial("tcp", host)
	}
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn, reader: bufio.NewReader(conn), timeout: 30 * time.Second}, nil
}

func (c *Client) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

func (c *Client) Auth(key string) error {
	value, err := c.Do("AUTH", key)
	if err != nil {
		return err
	}
	if text, ok := value.(string); ok && strings.EqualFold(text, "OK") {
		return nil
	}
	return nil
}

func (c *Client) Pop(queue string, side string, count int) ([]string, error) {
	command := "RPOP"
	if strings.EqualFold(side, "left") || strings.EqualFold(side, "lpop") {
		command = "LPOP"
	}
	value, err := c.Do(command, queue, strconv.Itoa(count))
	if err != nil {
		return nil, err
	}
	if value == nil {
		return nil, nil
	}
	switch item := value.(type) {
	case string:
		if item == "" {
			return nil, nil
		}
		return []string{item}, nil
	case []any:
		result := make([]string, 0, len(item))
		for _, entry := range item {
			if text, ok := entry.(string); ok {
				result = append(result, text)
			}
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unexpected RESP pop response %T", value)
	}
}

func (c *Client) Do(args ...string) (any, error) {
	if c == nil || c.conn == nil {
		return nil, errors.New("RESP client is closed")
	}
	if c.subscribed {
		return nil, errors.New("RESP client is in subscribe mode")
	}
	if err := c.conn.SetDeadline(time.Now().Add(c.timeout)); err != nil {
		return nil, err
	}
	if _, err := c.conn.Write(encodeCommand(args)); err != nil {
		return nil, err
	}
	return c.readValue()
}

// Subscribe 订阅指定频道。必须在 AUTH 之后调用。成功后客户端进入订阅模式，
// 后续应通过 ReadMessage 读取消息，PING 通过 SendSubscribePing 发送。
func (c *Client) Subscribe(channel string) error {
	if c == nil || c.conn == nil {
		return errors.New("RESP client is closed")
	}
	if c.subscribed {
		return errors.New("RESP client is already in subscribe mode")
	}
	if err := c.conn.SetDeadline(time.Now().Add(c.timeout)); err != nil {
		return err
	}
	if _, err := c.conn.Write(encodeCommand([]string{"SUBSCRIBE", channel})); err != nil {
		return err
	}
	value, err := c.readValue()
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unknown command") ||
			strings.Contains(strings.ToLower(err.Error()), "unsupported") {
			return ErrUnsupportedSubscribe
		}
		return err
	}
	frame, ok := value.([]any)
	if !ok || len(frame) < 3 {
		return fmt.Errorf("unexpected SUBSCRIBE response: %v", value)
	}
	kind, _ := frame[0].(string)
	name, _ := frame[1].(string)
	if !strings.EqualFold(kind, "subscribe") || name != channel {
		return fmt.Errorf("unexpected SUBSCRIBE response: %v", value)
	}
	c.subscribed = true
	// 进入订阅模式后清除 deadline，超时由调用方通过 SetReadDeadline 控制。
	return c.conn.SetDeadline(time.Time{})
}

// ReadMessage 阻塞读取一条 PUBLISH 推送的消息，自动跳过 subscribe/unsubscribe/pong 控制帧。
// 调用方应通过 SetReadDeadline 控制读超时。
func (c *Client) ReadMessage() (string, string, error) {
	if c == nil || c.conn == nil {
		return "", "", errors.New("RESP client is closed")
	}
	if !c.subscribed {
		return "", "", errors.New("RESP client is not in subscribe mode")
	}
	for {
		value, err := c.readValue()
		if err != nil {
			return "", "", err
		}
		switch frame := value.(type) {
		case []any:
			if len(frame) == 0 {
				continue
			}
			kind, _ := frame[0].(string)
			switch strings.ToLower(kind) {
			case "message":
				if len(frame) < 3 {
					return "", "", fmt.Errorf("invalid message frame: %v", frame)
				}
				channel, _ := frame[1].(string)
				payload, _ := frame[2].(string)
				return channel, payload, nil
			case "subscribe", "unsubscribe", "pong":
				continue
			default:
				return "", "", fmt.Errorf("unsupported subscribe frame: %v", frame)
			}
		case string:
			if strings.EqualFold(frame, "PONG") {
				continue
			}
			return "", "", fmt.Errorf("unexpected RESP value: %q", frame)
		default:
			return "", "", fmt.Errorf("unexpected RESP frame type: %T", frame)
		}
	}
}

// SendSubscribePing 在订阅模式下发送 PING 用于 keepalive，响应由 ReadMessage 跳过。
func (c *Client) SendSubscribePing() error {
	if c == nil || c.conn == nil {
		return errors.New("RESP client is closed")
	}
	if !c.subscribed {
		return errors.New("RESP client is not in subscribe mode")
	}
	_, err := c.conn.Write(encodeCommand([]string{"PING"}))
	return err
}

// SetReadDeadline 设置底层连接的读超时，主要供订阅模式使用。
func (c *Client) SetReadDeadline(t time.Time) error {
	if c == nil || c.conn == nil {
		return errors.New("RESP client is closed")
	}
	return c.conn.SetReadDeadline(t)
}

func encodeCommand(args []string) []byte {
	var builder strings.Builder
	builder.WriteByte('*')
	builder.WriteString(strconv.Itoa(len(args)))
	builder.WriteString("\r\n")
	for _, arg := range args {
		builder.WriteByte('$')
		builder.WriteString(strconv.Itoa(len(arg)))
		builder.WriteString("\r\n")
		builder.WriteString(arg)
		builder.WriteString("\r\n")
	}
	return []byte(builder.String())
}

func (c *Client) readValue() (any, error) {
	prefix, err := c.reader.ReadByte()
	if err != nil {
		return nil, err
	}
	switch prefix {
	case '+':
		return c.readLine()
	case '-':
		line, err := c.readLine()
		if err != nil {
			return nil, err
		}
		return nil, errors.New(line)
	case ':':
		line, err := c.readLine()
		if err != nil {
			return nil, err
		}
		return strconv.ParseInt(line, 10, 64)
	case '$':
		return c.readBulkString()
	case '*':
		return c.readArray()
	case '_':
		_, err := c.readLine()
		return nil, err
	default:
		return nil, fmt.Errorf("unsupported RESP prefix %q", prefix)
	}
}

func (c *Client) readLine() (string, error) {
	line, err := c.reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r"), nil
}

func (c *Client) readBulkString() (any, error) {
	line, err := c.readLine()
	if err != nil {
		return nil, err
	}
	length, err := strconv.Atoi(line)
	if err != nil {
		return nil, err
	}
	if length < 0 {
		return nil, nil
	}
	data := make([]byte, length+2)
	if _, err := io.ReadFull(c.reader, data); err != nil {
		return nil, err
	}
	return string(data[:length]), nil
}

func (c *Client) readArray() (any, error) {
	line, err := c.readLine()
	if err != nil {
		return nil, err
	}
	length, err := strconv.Atoi(line)
	if err != nil {
		return nil, err
	}
	if length < 0 {
		return nil, nil
	}
	result := make([]any, 0, length)
	for i := 0; i < length; i++ {
		value, err := c.readValue()
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, nil
}

func parseURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("upstream URL is empty")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "http://" + trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, err
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("invalid upstream URL %q", raw)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("unsupported upstream scheme %q", parsed.Scheme)
	}
	return parsed, nil
}
