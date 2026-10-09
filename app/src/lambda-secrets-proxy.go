// Stand-in for the AWS Parameters and Secrets Lambda Extension: answers on :2773 from the emulator's Secrets Manager.
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	endpoint, region := os.Getenv("AWS_ENDPOINT_URL"), os.Getenv("AWS_REGION")
	http.HandleFunc("/secretsmanager/get", func(w http.ResponseWriter, r *http.Request) {
		body := fmt.Sprintf(`{"SecretId":%q}`, r.URL.Query().Get("secretId"))
		req, _ := http.NewRequest("POST", endpoint, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/x-amz-json-1.1")
		req.Header.Set("X-Amz-Target", "secretsmanager.GetSecretValue")
		req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=test/%s/%s/secretsmanager/aws4_request, SignedHeaders=host, Signature=0", time.Now().UTC().Format("20060102"), region))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		w.WriteHeader(res.StatusCode)
		io.Copy(w, res.Body)
	})
	http.ListenAndServe("127.0.0.1:2773", nil)
}
