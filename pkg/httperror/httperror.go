package httperror

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strconv"

	"github.com/segmentio/encoding/json"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/pkg/clickhouse/ch"
)

var ErrRequestTimeout = New(http.StatusRequestTimeout,
	"request_timeout", "The server timed out waiting for the request")

type Error interface {
	error
	HTTPStatusCode() int
}

//------------------------------------------------------------------------------

func Wrap(err error) Error {
	return wrappedError{
		error: err,
	}
}

type wrappedError struct {
	error
}

func (e wrappedError) HTTPStatusCode() int {
	return http.StatusBadRequest
}

func (e wrappedError) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"status":  e.HTTPStatusCode(),
		"code":    "bad_request",
		"message": e.Error(),
	})
}

//------------------------------------------------------------------------------

type httpError struct {
	Status  int    `json:"status"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *httpError) HTTPStatusCode() int {
	return e.Status
}

func (e *httpError) Error() string {
	return e.Message
}

//------------------------------------------------------------------------------

func New(status int, code, msg string, args ...any) Error {
	if len(args) > 0 {
		msg = fmt.Sprintf(msg, args...)
	}
	return &httpError{
		Status:  status,
		Code:    code,
		Message: msg,
	}
}

func NotFound(msg string, args ...any) Error {
	return New(http.StatusNotFound, "not_found", msg, args...)
}

func Unauthorized(msg string, args ...any) Error {
	return New(http.StatusUnauthorized, "unauthorized", msg, args...)
}

func Forbidden(msg string, args ...any) Error {
	return New(http.StatusForbidden, "forbidden", msg, args...)
}

func BadRequest(code, msg string, args ...any) Error {
	return New(http.StatusBadRequest, code, msg, args...)
}

func InternalServerError(msg string, args ...any) Error {
	return New(http.StatusInternalServerError, "internal", msg, args...)
}

func Timeout(msg string, args ...any) Error {
	return New(http.StatusGatewayTimeout, "timeout", msg, args...)
}

//------------------------------------------------------------------------------

var errType = reflect.TypeOf(errors.New(""))

func From(err error) Error {
	switch err := err.(type) {
	case Error:
		return err
	case *json.SyntaxError:
		return BadRequest("json_syntax", err.Error())
	case *json.UnmarshalTypeError:
		return BadRequest("json_unmarshal", err.Error())
	case *strconv.NumError:
		return BadRequest("strconv_num", err.Error())
	case pgdriver.Error:
		return internalError(err)
	case *ch.Error:
		if err.Timeout() {
			return Timeout(err.Message)
		}
		return internalError(err)
	}

	msg := err.Error()

	if msg == "http: request body too large" {
		return New(http.StatusRequestEntityTooLarge,
			"request_body_too_large", "HTTP request body too large")
	}
	if errors.Is(err, io.EOF) {
		return BadRequest("eof", "EOF reading HTTP request body")
	}
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return BadRequest("eof", "unexpected EOF")
	}
	if errors.Is(err, sql.ErrNoRows) {
		return NotFound("not found")
	}

	typ := reflect.TypeOf(err)
	if typ.String() == "uuid.invalidLengthError" {
		return BadRequest("uuid", msg)
	}
	if typ == errType {
		return BadRequest("bad_request", err.Error())
	}

	return internalError(err)
}

func internalError(err error) Error {
	typ := reflect.TypeOf(err).String()
	return InternalServerError(typ + ": " + err.Error())
}
