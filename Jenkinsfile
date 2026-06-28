pipeline {
  agent any

  environment {
    APP_PORT = '3000'
  }

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Build') {
      steps {
        sh 'docker compose build'
      }
    }

    stage('Deploy') {
      steps {
        // Production .env stored as a Jenkins "Secret file" credential
        // (Manage Jenkins > Credentials). credentialsId must match below.
        withCredentials([file(credentialsId: 'royscript-contact-env', variable: 'ENV_FILE')]) {
          sh '''
            cp "$ENV_FILE" .env
            docker compose up -d --build
          '''
        }
      }
    }

    stage('Health check') {
      steps {
        sh '''
          for i in $(seq 1 15); do
            if curl -fsS http://127.0.0.1:$APP_PORT/health > /dev/null; then
              echo "Health check passed"; exit 0
            fi
            echo "Waiting for app to come up... ($i)"; sleep 2
          done
          echo "Health check FAILED"; docker compose logs --tail 50; exit 1
        '''
      }
    }

    stage('Cleanup images') {
      steps {
        sh 'docker image prune -f'
      }
    }
  }

  post {
    always {
      // Don't leave production secrets in the workspace.
      sh 'rm -f .env || true'
    }
    failure {
      echo 'Deploy failed. Check the compose logs above.'
    }
  }
}
