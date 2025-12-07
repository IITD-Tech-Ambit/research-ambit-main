#!/bin/bash

# Check for changes in the last commit, excluding the 'client' folder
git diff HEAD^ HEAD --quiet . ':!client'
