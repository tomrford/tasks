package main

import (
	"os"

	"github.com/tomrford/tasks/cli/internal/cli"
)

var version = "dev"

func main() {
	os.Exit(cli.Run(os.Args[1:], version, os.Stdin, os.Stdout, os.Stderr))
}
